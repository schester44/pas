import italic from "@fontsource/inter/files/inter-latin-400-italic.woff?url";
import regular from "@fontsource/inter/files/inter-latin-400-normal.woff?url";
import medium from "@fontsource/inter/files/inter-latin-500-normal.woff?url";
import semibold from "@fontsource/inter/files/inter-latin-600-normal.woff?url";
import { registerFonts } from "./fonts";

registerFonts({ regular, italic, medium, semibold });

export * from "./shared";
