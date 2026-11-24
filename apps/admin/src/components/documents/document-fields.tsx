import type { SchemaNode } from "@pas/forms-core";
import { createContext, useContext } from "react";

const DocumentFields = createContext<readonly SchemaNode[]>([]);

/** Groups documents may read beyond the standard context, such as the product's enrichment data. */
export const DocumentFieldsProvider = DocumentFields.Provider;

export const useDocumentFields = () => useContext(DocumentFields);
