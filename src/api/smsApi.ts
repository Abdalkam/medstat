// src/api/smsApi.ts

export async function sendSms(recipients: string[], message: string) {
  const token = localStorage.getItem("authToken");
  
  if (!token || token === "offline-mode-pending-sync") {
    throw new Error("You must be online and logged in to send SMS.");
  }

  // Borrowed exactly from authApi.ts
  const API_BASE = import.meta.env.VITE_API_URL || 
    (import.meta.env.PROD 
      ? "https://medstat-3rxl.onrender.com" 
      : "http://localhost:10000");

  const response = await fetch(`${API_BASE}/api/sms/send`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      recipients: recipients,
      message: message,
    }),
  });

  const data = await response.json();
  
  if (!response.ok) {
    // Create a custom error so we can attach the partial logs to it
    const error: any = new Error(data.error || "Failed to send SMS");
    
    // If the backend provided logs (e.g., some succeeded, some failed), attach them
    // so the frontend can still save the successful ones to the local DB.
    if (data.logs) {
      error.logs = data.logs;
    }
    
    throw error;
  }
  
  return data;
}