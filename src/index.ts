// Public entry point. The client and resource types are wired up in later steps.
export const VERSION = "0.1.0";

export {
  OneClickError,
  AuthError,
  ForbiddenError,
  InsufficientBalanceError,
  DuplicateRefError,
  ValidationError,
  NotFoundError,
  RateLimitError,
  ServiceError,
  NetworkError,
  RequestError,
  errorFromResponse,
} from "./errors";
export type {
  OneClickErrorCode,
  OneClickErrorOptions,
  ValidationIssue,
  ValidationErrorOptions,
  RateLimitErrorOptions,
} from "./errors";

export type {
  HttpMethod,
  FetchLike,
  RetryConfig,
  Pagination,
  ResponseMeta,
  Envelope,
} from "./http";

export { Secret, isSecret, reveal } from "./secret";

export { pollUntil, PollTimeoutError } from "./poll";
export type { PollOptions } from "./poll";

export {
  Issues,
  requireText,
  isMobileNumber,
  isAdslNumber,
  isFourgNumber,
  isWholeAmount,
  MOBILE_NUMBER,
  ADSL_NUMBER,
  FOURG_NUMBER,
} from "./validate";

export type { Page } from "./resources/base";

export { generateRef } from "./ref";

export type {
  MobilePlans,
  DynamicMobilePlan,
  FixedMobilePlan,
  MobileSendInput,
  MobileSendResult,
  MobileTopup,
  SuggestedOffer,
  MobileListParams,
} from "./resources/mobile";

export type {
  InternetType,
  InternetProduct,
  InternetProducts,
  NumberCheck,
  InternetSendInput,
  InternetSendResult,
  InternetTopup,
  InternetListParams,
} from "./resources/internet";

export type {
  GiftProductSummary,
  GiftCategory,
  GiftCatalog,
  GiftProductType,
  GiftProductDetails,
  GiftOrderInput,
  GiftOrderResult,
  GiftCard,
  GiftOrder,
  GiftOrdersParams,
} from "./resources/giftcards";

export {
  TOPUP_TERMINAL,
  GIFT_TERMINAL,
  PAYMENT_TERMINAL,
} from "./types";
export type {
  TopupStatus,
  GiftOrderStatus,
  PaymentStatus,
  KeyType,
  KeyScope,
  ApiKeyInfo,
  ValidateResult,
  ServiceHealth,
  Balance,
  Transaction,
  TransactionsParams,
  ItemsPage,
} from "./types";
