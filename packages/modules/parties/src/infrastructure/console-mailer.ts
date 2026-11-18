import type { Mailer, MailMessage } from "../ports/mailer";

interface LineLogger {
  info(object: Record<string, unknown>, message: string): void;
}

/** Dev and sandbox mail: written to the process log instead of sent. */
export class ConsoleMailer implements Mailer {
  constructor(private readonly logger: LineLogger) {}

  async send(message: MailMessage): Promise<void> {
    this.logger.info(
      { mail: { to: message.to, subject: message.subject, tag: message.tag } },
      `\n--- mail to ${message.to}: ${message.subject}\n${message.text}\n---`,
    );
  }
}
