import type { ClockProvider, Outbox, UnitOfWork } from "@pas/kernel";
import type {
  ExtensionRepository,
  ExtensionRunRepository,
  SubscriptionRepository,
} from "../ports/repositories";
import type {
  ExtensionCompiler,
  ExtensionEnvironments,
  ExtensionRunner,
  SecretBox,
} from "../ports/services";

export interface ExtensionDeps {
  uow: UnitOfWork;
  outbox: Outbox;
  clocks: ClockProvider;
  extensions: ExtensionRepository;
  subscriptions: SubscriptionRepository;
  runs: ExtensionRunRepository;
  secrets: SecretBox;
  compiler: ExtensionCompiler;
  runner: ExtensionRunner;
  environments: ExtensionEnvironments;
}
