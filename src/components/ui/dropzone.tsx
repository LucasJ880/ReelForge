"use client";

import { useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { EmptyUploadIllustration } from "@/components/editorial/empty-upload-illustration";
import { cn } from "@/lib/utils";

export interface FileDropzoneProps {
  accept?: string;
  multiple?: boolean;
  disabled?: boolean;
  uploading?: boolean;
  title: string;
  description: string;
  className?: string;
  onFiles: (files: File[]) => void;
  onRejected?: (files: File[]) => void;
}

export function FileDropzone({
  accept = "image/png,image/jpeg,image/webp",
  multiple = true,
  disabled = false,
  uploading = false,
  title,
  description,
  className,
  onFiles,
  onRejected,
}: FileDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  function handleFiles(fileList: FileList | null) {
    if (!fileList || disabled || uploading) return;
    const allowed = accept
        .split(",")
        .map((item) => item.trim());
    const files = Array.from(fileList);
    const accepted = files.filter((file) =>
      allowed.some((mime) => file.type === mime || mime.endsWith("/*")),
    );
    const rejected = files.filter((file) => !accepted.includes(file));
    if (rejected.length > 0) onRejected?.(rejected);
    if (accepted.length > 0) onFiles(accepted);
  }

  return (
    <div
      className={cn(
        "rounded-(--radius-lg) border border-dashed bg-muted px-4 py-8 text-center transition-[border-color,background-color] duration-fast ease-out motion-reduce:transition-none sm:px-6",
        dragging ? "border-primary bg-accent-soft" : "border-border",
        disabled && "opacity-60",
        className,
      )}
      onDragEnter={(event) => {
        event.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        handleFiles(event.dataTransfer.files);
      }}
    >
      <input
        ref={inputRef}
        type="file"
        hidden
        multiple={multiple}
        accept={accept}
        disabled={disabled || uploading}
        onChange={(event) => {
          handleFiles(event.target.files);
          event.target.value = "";
        }}
      />
      <button
        type="button"
        disabled={disabled || uploading}
        onClick={() => inputRef.current?.click()}
        className="mx-auto flex w-full max-w-md flex-col items-center gap-3 rounded-(--radius-md) transition-colors duration-fast ease-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none"
      >
        {uploading ? (
          <Loader2 className="size-8 animate-spin text-muted-foreground motion-reduce:animate-none" />
        ) : (
          <EmptyUploadIllustration className="size-16 text-muted-foreground" />
        )}
        <span className="text-body font-medium text-foreground">{title}</span>
        <span className="max-w-sm text-meta text-muted-foreground">{description}</span>
      </button>
    </div>
  );
}
