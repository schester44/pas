export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  /** What kind of mail this is, for logs and provider templates. */
  tag: "client_sign_in_code" | "client_portal_invite";
}

/** Outbound email. Dev logs to the console; a real provider plugs in here. */
export interface Mailer {
  send(message: MailMessage): Promise<void>;
}
