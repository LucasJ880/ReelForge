import { FileText } from "lucide-react";
import { Button } from "@/components/ui/button";

type SubtitleDownloadLinkProps = {
  subtitleFileUrl: string;
  label: string;
  filename: string;
};

export function SubtitleDownloadLink({
  subtitleFileUrl,
  label,
  filename,
}: SubtitleDownloadLinkProps) {
  return (
    <Button
      render={
        <a
          href={subtitleFileUrl}
          download={filename}
          target="_blank"
          rel="noreferrer"
        />
      }
      variant="outline"
      size="sm"
    >
      <FileText aria-hidden />
      {label}
    </Button>
  );
}
