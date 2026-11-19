/// <reference types="fixture-ambient" />
import { openPage } from "kit-alias";
import { openView } from "pnpm-view";
import { makeFallback } from "fallback-kit";
import { untyped } from "untyped-kit";
import { shadow } from "shadowed-kit";

const page = openPage();
page.locator('input[name="lastName"]');
openView().refresh();
makeFallback().result();
untyped();
shadow();
ambientService.execute();
fetch("https://example.invalid");
