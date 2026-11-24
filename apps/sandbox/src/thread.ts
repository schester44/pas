import { runInvocation } from "@pas/sandbox/runtime";
import { parentPort } from "node:worker_threads";
import type { FromThread, ToThread } from "./messages";

if (!parentPort) throw new Error("thread.ts runs as a worker thread");

const port = parentPort;

const pendingCalls = new Map<
  string,
  { resolve: (value: unknown) => void; reject: (error: Error) => void }
>();

const cancels = new Map<string, AbortController>();
const post = (message: FromThread) => port.postMessage(message);

port.on("message", (message: ToThread) => {
  switch (message.type) {
    case "invoke": {
      const { invocation } = message;
      const controller = new AbortController();
      let nextCallId = 0;

      cancels.set(invocation.invocationId, controller);

      void runInvocation(invocation, {
        signal: controller.signal,
        host: (name, args) =>
          new Promise((resolve, reject) => {
            const callId = nextCallId++;

            pendingCalls.set(`${invocation.invocationId}:${callId}`, { resolve, reject });
            post({ type: "host_call", invocationId: invocation.invocationId, callId, name, args });
          }),
      }).then((result) => {
        cancels.delete(invocation.invocationId);

        for (const key of pendingCalls.keys()) {
          if (key.startsWith(`${invocation.invocationId}:`)) pendingCalls.delete(key);
        }

        post({ type: "done", invocationId: invocation.invocationId, result });
      });

      break;
    }

    case "host_result": {
      const key = `${message.invocationId}:${message.callId}`;
      const pending = pendingCalls.get(key);

      pendingCalls.delete(key);

      if (message.ok) pending?.resolve(message.value);
      else pending?.reject(new Error(message.error ?? "Host call failed"));

      break;
    }

    case "cancel":
      cancels.get(message.invocationId)?.abort();
      break;
  }
});
