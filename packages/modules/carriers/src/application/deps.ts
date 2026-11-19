import type { ClockProvider, UnitOfWork, Workflows } from "@pas/kernel";
import type { ObjectStorage } from "@pas/storage";
import type {
  CallbackInbox,
  CarrierRepository,
  ConnectionLocator,
  ConnectorRepository,
  FeedRepository,
  FlowRunRepository,
  PolicyLinkRepository,
} from "../ports/repositories";
import type {
  CarrierEnvironments,
  CarrierExtensionRegistry,
  FeedChannels,
  FeedSource,
  HttpTransport,
  SecretBox,
  TokenCache,
} from "../ports/services";

export interface CarrierDeps {
  uow: UnitOfWork;
  clocks: ClockProvider;
  carriers: CarrierRepository;
  connectors: ConnectorRepository;
  runs: FlowRunRepository;
  callbacks: CallbackInbox;
  locator: ConnectionLocator;
  links: PolicyLinkRepository;
  feeds: FeedRepository;
  secrets: SecretBox;
  http: HttpTransport;
  tokens: TokenCache;
  environments: CarrierEnvironments;
  extensions: CarrierExtensionRegistry;
  storage: ObjectStorage;
  feedSource: FeedSource;
  feedChannels: FeedChannels;
  /** Lazy: the worker builds its workflow engine after the carrier services. */
  workflows: () => Workflows;
  /** Public origin of the API, for callback URLs. */
  publicUrl: string;
}
