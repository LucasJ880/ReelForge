import { getDownloadUrl } from "@vercel/blob";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";

type VideoDownloadLinkProps = {
  videoUrl: string;
  label: string;
  filename: string;
};

export function getCustomerDownloadUrl(videoUrl: string): string {
  return getDownloadUrl(videoUrl);
}

export function VideoDownloadLink({ videoUrl, label, filename }: VideoDownloadLinkProps) {
  return (
    <Button
      render={
        <a
          href={getCustomerDownloadUrl(videoUrl)}
          download={filename}
        />
      }
      size="sm"
    >
      <Download aria-hidden />
      {label}
    </Button>
  );
}
