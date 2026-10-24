import { useRef, useState } from "react";
import { Upload, FileSpreadsheet, X, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function FileUploader({ onFileSelect }: { onFileSelect?: (file: File) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [dragging, setDragging] = useState(false);

  const handleFile = (file: File) => {
    setFileName(file.name);
    onFileSelect?.(file);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) handleFile(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file && (file.name.endsWith(".xlsx") || file.name.endsWith(".csv"))) {
      handleFile(file);
    }
  };

  return (
    <section className="space-y-2">
      <label className="block text-sm font-medium">Website List</label>
      <p className="text-xs text-muted-foreground">
        Upload an Excel (.xlsx) or CSV file with one website URL per row. Article content comes from your brief above.
      </p>

      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        className={`relative flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-8 text-center transition-all
          ${dragging
            ? "border-violet-500 bg-violet-500/10 shadow-lg shadow-violet-500/10"
            : fileName
              ? "border-emerald-500/40 bg-emerald-500/5"
              : "border-border hover:border-violet-500/40 hover:bg-violet-500/5"
          }`}
      >
        <input
          type="file"
          accept=".xlsx,.csv"
          ref={inputRef}
          className="hidden"
          onChange={handleChange}
        />

        {fileName ? (
          <>
            <div className="flex size-12 items-center justify-center rounded-full bg-emerald-500/10">
              <CheckCircle2 className="size-6 text-emerald-500" />
            </div>
            <div>
              <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">{fileName}</p>
              <p className="mt-1 text-xs text-muted-foreground">Click to change file</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={(e) => { e.stopPropagation(); setFileName(""); }}
              className="gap-1.5"
            >
              <X className="size-3" /> Clear
            </Button>
          </>
        ) : (
          <>
            <div className={`flex size-12 items-center justify-center rounded-full transition-all ${dragging ? "bg-violet-500/20" : "bg-muted"}`}>
              {dragging
                ? <Upload className="size-6 text-violet-500 animate-bounce" />
                : <FileSpreadsheet className="size-6 text-muted-foreground" />
              }
            </div>
            <div>
              <p className="text-sm font-medium">
                {dragging ? "Drop it!" : "Drag & drop or click to upload"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">.xlsx or .csv · one URL per row</p>
            </div>
            <Button variant="outline" size="sm" className="gap-1.5 pointer-events-none">
              <Upload className="size-3" /> Choose File
            </Button>
          </>
        )}
      </div>
    </section>
  );
}
