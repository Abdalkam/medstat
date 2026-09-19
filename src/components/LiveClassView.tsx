// src/components/LiveClassView.tsx
import type { CourseMaterial } from "../types";

interface Props {
  material: CourseMaterial & { file_data?: string };
  page: number;
}

export default function LiveClassView({ material, page }: Props) {
  // Aggressively check for file data. 
  // Sometimes it's mapped to file_data, fileUrl, or file_url
  const rawFileData: string = material.file_data || material.fileUrl || (material as any).file_url || "";
  const fileType: string = material.fileType || (material as any).file_type || "";
  const fileName: string = material.fileName || (material as any).file_name || material.title || "file";

  // Detect PDF from base64 header or fileType field
  const isPdf = fileType.includes("pdf") || rawFileData.startsWith("data:application/pdf") || rawFileData.startsWith("%PDF") || rawFileData.startsWith("JVBER");
  const isVideo = fileType.includes("video") || rawFileData.startsWith("data:video/");
  const isAudio = fileType.includes("audio") || rawFileData.startsWith("data:audio/");
  const isImage = fileType.includes("image") || rawFileData.startsWith("data:image/");
  const isPptx = fileType.includes("presentation") || fileType.includes("ppt") || fileName.toLowerCase().endsWith(".pptx");
  const isWord = fileType.includes("word") || fileType.includes("document") || fileName.toLowerCase().endsWith(".docx");

  const containerStyle: React.CSSProperties = {
    width: "100%",
    height: "100%",
    display: "flex",
    overflow: "hidden",
    borderRadius: "12px",
    background: "#FFFFFF"
  };

  if (isPdf && rawFileData) {
    const pdfSrc = rawFileData.startsWith("data:")
      ? rawFileData
      : `data:application/pdf;base64,${rawFileData}`;

    return (
      <div style={{
        width: "100%",
        height: "100%",
        overflow: "hidden",
        background: "#FFFFFF",
        borderRadius: "12px"
      }}>
        <iframe
          src={`${pdfSrc}#page=${page}&zoom=page-fit&view=FitH&toolbar=0&navpanes=0`}
          title={material.title || "PDF"}
          style={{
            width: "100%",
            height: "100%",
            border: "none",
            outline: "none",
            display: "block",
            background: "#FFFFFF",
            colorScheme: "light"
          }}
          allowFullScreen
        />
      </div>
    );
  }

  if (isVideo && rawFileData) {
    const videoSrc = rawFileData.startsWith("data:") ? rawFileData : `data:video/mp4;base64,${rawFileData}`;
    return (
      <div style={{
        ...containerStyle,
        alignItems: "center",
        justifyContent: "center",
        background: "#000000"
      }}>
        <video
          src={videoSrc}
          controls
          autoPlay
          style={{
            width: "100%",
            height: "100%",
            objectFit: "contain",
            border: "none",
            outline: "none",
            display: "block",
            borderRadius: "12px"
          }}
        >
          Your browser does not support the video tag.
        </video>
      </div>
    );
  }

  if (isAudio && rawFileData) {
    const audioSrc = rawFileData.startsWith("data:") ? rawFileData : `data:audio/mp3;base64,${rawFileData}`;
    return (
      <div style={{
        ...containerStyle,
        justifyContent: "center",
        alignItems: "center",
        background: "#F2F2F7"
      }}>
        <div style={{
          textAlign: "center",
          color: "#1C1C1E",
          background: "#FFFFFF",
          padding: "32px",
          borderRadius: "16px",
          boxShadow: "0 4px 12px rgba(0,0,0,0.05)"
        }}>
          <div style={{ fontSize: "64px", marginBottom: "16px" }}>🎵</div>
          <h3 style={{ margin: "0 0 16px 0", fontSize: "18px", fontWeight: "600" }}>
            {material.title || "Audio"}
          </h3>
          <audio
            src={audioSrc}
            controls
            autoPlay
            style={{ width: "300px", outline: "none" }}
          >
            Your browser does not support the audio element.
          </audio>
        </div>
      </div>
    );
  }

  if (isImage && rawFileData) {
    const imgSrc = rawFileData.startsWith("data:") ? rawFileData : `data:image/png;base64,${rawFileData}`;
    return (
      <div style={{
        ...containerStyle,
        background: "#FFFFFF"
      }}>
        <img
          src={imgSrc}
          alt={material.title || "Image"}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "contain",
            border: "none",
            outline: "none",
            display: "block",
            borderRadius: "12px"
          }}
        />
      </div>
    );
  }

  if ((isPptx || isWord) && rawFileData) {
    const downloadSrc = rawFileData.startsWith("data:") ? rawFileData : `data:application/octet-stream;base64,${rawFileData}`;
    return (
      <div style={{
        ...containerStyle,
        justifyContent: "center",
        alignItems: "center",
        background: "#F2F2F7"
      }}>
        <div style={{
          textAlign: "center",
          color: "#1C1C1E",
          background: "#FFFFFF",
          padding: "40px",
          borderRadius: "16px",
          boxShadow: "0 4px 12px rgba(0,0,0,0.05)",
          maxWidth: "400px"
        }}>
          <div style={{ fontSize: "64px", marginBottom: "16px" }}>
            {isPptx ? "📊" : "📄"}
          </div>
          <h3 style={{ margin: "0 0 8px 0", fontSize: "18px", fontWeight: "600" }}>
            {material.title || "File"}
          </h3>
          <p style={{ margin: "0 0 16px 0", fontSize: "14px", color: "#8E8E93" }}>
            Web browsers cannot natively render PowerPoint or Word files.
          </p>
          <p style={{ margin: "0 0 24px 0", fontSize: "14px", color: "#8E8E93" }}>
            For the best live presentation experience, please upload <strong>PDFs</strong> or <strong>Images</strong>.
          </p>
          <a
            href={downloadSrc}
            download={fileName}
            style={{
              display: "inline-block",
              padding: "12px 24px",
              background: "#0A84FF",
              color: "#fff",
              textDecoration: "none",
              borderRadius: "10px",
              fontWeight: "600",
              fontSize: "15px"
            }}
          >
            ⬇️ Download File
          </a>
        </div>
      </div>
    );
  }

  // Fallback — also handle raw base64 PDF that wasn't caught above
  if (rawFileData && (rawFileData.startsWith("JVBER") || rawFileData.startsWith("%PDF"))) {
    const pdfSrc = `data:application/pdf;base64,${rawFileData}`;
    return (
      <div style={{
        width: "100%",
        height: "100%",
        overflow: "hidden",
        background: "#FFFFFF",
        borderRadius: "12px"
      }}>
        <iframe
          src={`${pdfSrc}#page=${page}&zoom=page-fit&view=FitH&toolbar=0&navpanes=0`}
          title={material.title || "PDF"}
          style={{
            width: "100%",
            height: "100%",
            border: "none",
            outline: "none",
            display: "block",
            background: "#FFFFFF",
            colorScheme: "light"
          }}
          allowFullScreen
        />
      </div>
    );
  }

  return (
    <div style={{
      ...containerStyle,
      justifyContent: "center",
      alignItems: "center",
      background: "#F2F2F7"
    }}>
      <div style={{
        textAlign: "center",
        color: "#1C1C1E",
        background: "#FFFFFF",
        padding: "40px",
        borderRadius: "16px",
        boxShadow: "0 4px 12px rgba(0,0,0,0.05)",
        maxWidth: "400px"
      }}>
        <div style={{ fontSize: "64px", marginBottom: "16px" }}>📄</div>
        <h3 style={{ margin: "0 0 8px 0", fontSize: "18px", fontWeight: "600" }}>
          {material.title || "File"}
        </h3>
        <p style={{ margin: "0 0 24px 0", fontSize: "14px", color: "#8E8E93" }}>
          Live preview is not available for this file type.
        </p>
      </div>
    </div>
  );
}