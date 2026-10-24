import { createFileRoute } from "@tanstack/react-router";
import { parse } from "csv-parse/sync";
import * as xlsx from "xlsx";
import { parseRows } from "@/lib/guestpilot";

export const Route = createFileRoute("/api/upload")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let form: FormData;
        try {
          form = await request.formData();
        } catch {
          return Response.json({ error: "Invalid multipart form data" }, { status: 400 });
        }

        const file = form.get("file");
        if (!file || typeof file === "string") {
          return Response.json({ error: "Choose a file to upload" }, { status: 400 });
        }

        const extension = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
        if (extension !== ".csv" && extension !== ".xlsx") {
          return Response.json(
            { error: "Unsupported file type. Upload a CSV or XLSX file." },
            { status: 400 },
          );
        }
        if (file.size === 0) {
          return Response.json({ error: "The uploaded file is empty" }, { status: 400 });
        }
        const MAX_BYTES = 5 * 1024 * 1024; // 5 MB limit
        if (file.size > MAX_BYTES) {
          return Response.json(
            { error: `File is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum allowed is 5 MB.` },
            { status: 413 },
          );
        }

        let records: Record<string, unknown>[];
        try {
          if (extension === ".csv") {
            const csv = (await file.text()).replace(/^\uFEFF/, "");
            records = parse(csv, { columns: true, skip_empty_lines: true }) as Record<
              string,
              unknown
            >[];
          } else {
            const workbook = xlsx.read(new Uint8Array(await file.arrayBuffer()), { type: "array" });
            const firstSheet = workbook.SheetNames[0];
            if (!firstSheet) {
              return Response.json({ error: "The XLSX file has no worksheets" }, { status: 400 });
            }
            records = xlsx.utils.sheet_to_json<Record<string, unknown>>(
              workbook.Sheets[firstSheet]!,
              { defval: "" },
            );
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unknown file parsing error";
          return Response.json(
            { error: `Unable to read the uploaded file: ${message}` },
            { status: 400 },
          );
        }

        const { rows, issues, ignoredSecrets, map } = parseRows(records);
        return Response.json({ rows, issues, ignoredSecrets, filename: file.name, map });
      },
    },
  },
});
