import { useState } from "react";
import { useNavigate } from "react-router-dom";

const MEDICAL_BLUE = "#007AFF";

export default function Startup() {
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (phone.length < 10) {
      setError("Please enter a valid phone number");
      return;
    }
    
    setLoading(true);
    setError("");
    
    try {
      // TODO: Replace with your actual Supabase/Auth API call to send the SMS code
      // await sendAuthCode(phone);
      
      // Simulating API delay for UI demonstration
      await new Promise((resolve) => setTimeout(resolve, 1000));
      
      // Navigate to the VerifyCode component, passing the phone number
      // Adjust the route path if your verify screen is on a different URL
      navigate("/verify", { state: { phone } });
      
    } catch (err: any) {
      setError(err.message || "Failed to send code. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        width: "100%",
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: "#FFFFFF", // Uniform white background
        fontFamily: "-apple-system, sans-serif",
        overflow: "hidden",
        position: "relative",
        padding: "24px",
        boxSizing: "border-box",
      }}
    >
      {/* Animations */}
      <style>{`
        @keyframes heartbeat {
          0% { transform: scale(1); }
          15% { transform: scale(1.1); }
          30% { transform: scale(1); }
          45% { transform: scale(1.05); }
          60% { transform: scale(1); }
          100% { transform: scale(1); }
        }
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      {/* Logo & Title Section */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          marginBottom: "48px",
          animation: "fadeUp 0.6s ease-out",
        }}
      >
        <img
          src="/applogo.png"
          alt="App Logo"
          style={{
            width: "96px",
            height: "96px",
            borderRadius: "20px",
            marginBottom: "24px",
            objectFit: "contain",
            animation: "heartbeat 2.5s infinite ease-in-out",
          }}
        />
        <h1
          style={{
            fontSize: "28px",
            fontWeight: "700",
            color: "#1C1C1E",
            marginBottom: "8px",
            letterSpacing: "-0.5px",
          }}
        >
          Welcome
        </h1>
        <p
          style={{
            color: "#8E8E93",
            fontSize: "15px",
            textAlign: "center",
            maxWidth: "300px",
          }}
        >
          Enter your phone number to receive a verification code.
        </p>
      </div>

      {/* Form Section */}
      <form
        onSubmit={handleSendCode}
        style={{
          width: "100%",
          maxWidth: "360px",
          display: "flex",
          flexDirection: "column",
          animation: "fadeUp 0.8s ease-out",
        }}
      >
        <input
          type="tel"
          placeholder="Phone Number"
          value={phone}
          onChange={(e) => setPhone(e.target.value.replace(/[^0-9+]/g, ""))}
          style={{
            width: "100%",
            height: "56px",
            padding: "0 16px",
            border: "none",
            outline: "none",
            background: "#F2F2F7", // iOS style light grey input
            fontSize: "17px",
            color: "#1C1C1E",
            boxSizing: "border-box",
            borderRadius: "12px",
            marginBottom: "16px",
            fontWeight: "500",
          }}
          autoFocus
        />

        {error && (
          <p
            style={{
              textAlign: "center",
              color: "#FF3B30",
              fontSize: "14px",
              marginBottom: "12px",
            }}
          >
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading || phone.length < 10}
          style={{
            width: "100%",
            height: "56px",
            border: "none",
            background: MEDICAL_BLUE,
            color: "white",
            fontSize: "16px",
            fontWeight: "600",
            borderRadius: "12px",
            cursor: loading || phone.length < 10 ? "not-allowed" : "pointer",
            opacity: loading || phone.length < 10 ? 0.4 : 1,
            transition: "opacity 0.2s ease",
          }}
        >
          {loading ? "Sending..." : "Send Code"}
        </button>
      </form>

      <p
        style={{
          position: "absolute",
          bottom: "24px",
          color: "#8E8E93",
          fontSize: "12px",
          textAlign: "center",
          padding: "0 24px",
        }}
      >
        By continuing, you agree to our Terms & Privacy Policy.
      </p>
    </div>
  );
}