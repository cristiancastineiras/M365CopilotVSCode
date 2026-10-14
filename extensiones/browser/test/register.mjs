import { register } from "node:module";
import { pathToFileURL } from "node:url";

register("./ts-resolver.mjs", pathToFileURL(import.meta.filename));
