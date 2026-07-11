import { rmSync } from "node:fs";

rmSync(".next/dev/types", { recursive: true, force: true });
rmSync(".next/types", { recursive: true, force: true });
