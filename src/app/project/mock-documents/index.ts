import { GZ_2025_DOCUMENT } from "./gz-2025.document";
import { SH_BALLET_DOCUMENT } from "./sh-ballet.document";
import type { ProjectDocument } from "../project-document-types";

export { GZ_2025_DOCUMENT } from "./gz-2025.document";
export { SH_BALLET_DOCUMENT } from "./sh-ballet.document";

export const MOCK_DOCUMENTS_BY_ID: Record<string, ProjectDocument> = {
  "gz-2025": GZ_2025_DOCUMENT,
  "sh-ballet": SH_BALLET_DOCUMENT,
};
