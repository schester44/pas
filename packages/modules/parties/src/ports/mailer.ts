export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  /** What kind of mail this is, for logs and provider templates. */
  tag: "client_sign_in_code" | "client_portal_invite";
}

/** Outbound email, resolved per tenant from its integrations (the console mailer by default). */
export interface Mailer {
  send(message: MailMessage): Promise<void>;
}
