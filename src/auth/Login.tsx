import { useState, useEffect } from "react";
import { Navigate } from "react-router-dom";
import AppBar from "../components/AppBar";
import LoadingButton from "../components/LoadingButton";
import { loginTenant } from "../api/authApi";
import { loginUser } from "../database/userDB";
import { supabase } from "../auth/supabase";
import { getVersion } from "@tauri-apps/api/app";

const MEDICAL_BLUE = "#007AFF";
const iosFont = "-apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif";

const S = {
  radiusLg: 24,
  radiusMd: 14,
  radiusSm: 10,
  shadowCard:
    "0 20px 60px rgba(16,24,40,0.12), 0 4px 12px rgba(16,24,40,0.06)",
  shadowBtn: "0 2px 10px rgba(0,122,255,0.35)",
  ringBlue: "0 0 0 3.5px rgba(0,122,255,0.16)",
  ease: "cubic-bezier(0.4, 0, 0.2, 1)",
};

export default function Login() {
  const [loginStep, setLoginStep] = useState(1);
  const [businessName, setBusinessName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [redirectRoute, setRedirectRoute] = useState<string | null>(null);
  const [publicSettings, setPublicSettings] = useState<any>(null);
  const [showCreateAccount, setShowCreateAccount] = useState(false);
  const [appVersion, setAppVersion] = useState("");

  useEffect(() => {
    getVersion()
      .then((v) => setAppVersion(v))
      .catch(() => {});
  }, []);

  if (redirectRoute) {
    return <Navigate to={redirectRoute} replace />;
  }

  async function handleContinue() {
    setMessage("");

    if (!businessName.trim()) {
      return setMessage("Institution name is required");
    }

    setLoading(true);

    try {
      const { data: tenants, error } = await supabase
        .from("tenants")
        .select("id")
        .eq("business_name", businessName.trim());

      if (error) throw error;

      if (!tenants || tenants.length === 0) {
        setMessage("Institution not found.");
        return;
      }

      if (tenants.length > 1) {
        setMessage(
          "Multiple institutions share this name. Please contact support."
        );
        return;
      }

      const { data, error: sErr } = await supabase
        .from("business_settings")
        .select("*")
        .eq("tenant_id", tenants[0].id)
        .maybeSingle();

      if (sErr) throw sErr;

      if (data) {
        setPublicSettings(data);
        setLoginStep(2);
      } else {
        setMessage(
          "Institution found, but its profile is not set up yet."
        );
      }
    } catch {
      setMessage(
        "Institution not found. Check the name or your connection."
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleLogin() {
    setMessage("");

    if (!username.trim() || !password.trim()) {
      return setMessage("Username and password are required");
    }

    try {
      setLoading(true);

      try {
        const result = await loginTenant({
          username,
          password,
          business_name:
            publicSettings?.business_name || businessName.trim(),
        });

        processLoginResult(result.user, result.authToken);
        return;
      } catch (backendError: any) {
        if (backendError?.noOfflineFallback) {
          throw backendError;
        }

        if (import.meta.env.DEV) {
          console.warn(
            "Backend login failed, trying offline DB.",
            backendError
          );
        }
      }

      const localUser = await loginUser(
        username.trim(),
        password,
        publicSettings?.tenant_id
      );

      if (localUser) {
        processLoginResult(localUser, "offline-mode-pending-sync");
      } else {
        throw new Error("Invalid username or password.");
      }
    } catch {
      setMessage("Invalid username or password.");
    } finally {
      setLoading(false);
    }
  }

  function processLoginResult(
    apiUser: Record<string, any>,
    authToken: string
  ) {
    const typed = username.trim();

    if (
      typeof apiUser.username !== "string" ||
      apiUser.username !== typed
    ) {
      setMessage("Invalid username or password.");
      return;
    }

    localStorage.setItem("authToken", authToken);

    const tenantId = (
      apiUser.tenant_id ||
      apiUser.tenantId ||
      publicSettings?.tenant_id
    ) as string;

    const userRole = apiUser.role as string;

    localStorage.setItem(
      "currentUser",
      JSON.stringify({
        id: apiUser.id as string,
        tenantId,
        role: userRole,
        username: apiUser.username,
        email: apiUser.email || "",
        phone: apiUser.phone || "",
        profilePic:
          apiUser.profile_pic || apiUser.profilePic || "",
        assignedCourses:
          apiUser.assigned_courses ||
          apiUser.assignedCourses ||
          [],
      })
    );

    window.dispatchEvent(new Event("authStateChanged"));

    if (userRole === "admin") {
      setRedirectRoute("/admin");
    } else if (userRole === "trainer") {
      setRedirectRoute("/trainer");
    } else {
      setRedirectRoute("/user");
    }
  }

  const stepLabel =
    loginStep === 1
      ? "Step 1 of 2 · Institution"
      : "Step 2 of 2 · Credentials";

  return (
    <div
      style={{
        width: "100%",
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        fontFamily: iosFont,
        overflow: "hidden",
        position: "relative",
        background:
          loginStep === 2 &&
          publicSettings?.login_background
            ? `url(${publicSettings.login_background}) center/cover no-repeat`
            : "linear-gradient(160deg, #EEF3FB 0%, #F2F2F7 45%, #EAF0FA 100%)",
      }}
    >
      <AppBar />

      {loginStep === 2 &&
        publicSettings?.login_background && (
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: "rgba(16,24,40,0.35)",
              zIndex: 0,
            }}
          />
        )}

      <div
        style={{
          flex: 1,
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          padding: 24,
          position: "relative",
          zIndex: 1,
        }}
      >
        <div
          key={loginStep}
          style={{
            width: "100%",
            maxWidth: 416,
            background: "rgba(255,255,255,0.88)",
            backdropFilter: "blur(30px)",
            WebkitBackdropFilter: "blur(30px)",
            borderRadius: S.radiusLg,
            padding: "36px 30px 30px",
            boxShadow: S.shadowCard,
            border: "1px solid rgba(255,255,255,0.85)",
            animation: `fadeUp 0.45s ${S.ease}`,
            position: "relative",
            overflow: "hidden",
          }}
        >
          <style>{`
            @keyframes fadeUp {
              from {
                opacity: 0;
                transform: translateY(16px);
              }
              to {
                opacity: 1;
                transform: translateY(0);
              }
            }

            @keyframes authSlide {
              0% {
                transform: translateX(-100%);
              }
              100% {
                transform: translateX(350%);
              }
            }

            @keyframes shake {
              0%, 100% {
                transform: translateX(0);
              }
              25% {
                transform: translateX(-5px);
              }
              75% {
                transform: translateX(5px);
              }
            }
          `}</style>

          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              height: 3,
              background: `linear-gradient(90deg, ${MEDICAL_BLUE}, #6FB6FF)`,
            }}
          />

          <div
            style={{
              position: "relative",
              width: 96,
              height: 96,
              margin: "0 auto 18px",
            }}
          >
            <div
              style={{
                position: "absolute",
                inset: -5,
                borderRadius: 27,
                background: `linear-gradient(135deg, ${MEDICAL_BLUE}33, #6FB6FF11)`,
                border: `1.5px solid ${MEDICAL_BLUE}2E`,
              }}
            />

            <img
              src={
                loginStep === 1
                  ? "/loadlogo.png"
                  : publicSettings?.logo || "/loadlogo.png"
              }
              alt="App Logo"
              style={{
                width: 96,
                height: 96,
                borderRadius: 24,
                objectFit: "cover",
                display: "block",
                position: "relative",
                boxShadow: "0 10px 28px rgba(0,0,0,0.12)",
                border: "1px solid rgba(0,0,0,0.05)",
              }}
            />
          </div>

          <h1
            style={{
              textAlign: "center",
              fontSize: 23,
              color: "#1C1C1E",
              fontWeight: 800,
              letterSpacing: "-0.02em",
              margin: "0 0 4px",
            }}
          >
            {showCreateAccount
              ? "Create Account"
              : loginStep === 2
              ? publicSettings?.business_name || "Sign In"
              : "Sign In"}
          </h1>

          {!showCreateAccount && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                marginBottom: 22,
              }}
            >
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: "#8E8E93",
                }}
              >
                {stepLabel}
              </span>

              <div style={{ display: "flex", gap: 5 }}>
                {[1, 2].map((s) => (
                  <span
                    key={s}
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: "50%",
                      background:
                        loginStep >= s
                          ? MEDICAL_BLUE
                          : "#D8D8DE",
                      transition: "background 0.25s",
                    }}
                  />
                ))}
              </div>
            </div>
          )}

          {showCreateAccount ? (
            <div style={{ textAlign: "center" }}>
              <p
                style={{
                  color: "#8E8E93",
                  fontSize: 14.5,
                  lineHeight: 1.6,
                  marginBottom: 22,
                }}
              >
                New accounts are created by your institution's
                administrator. If you are an administrator, you
                can register your institution on the landing page.
              </p>

              <button
                onClick={() => {
                  setShowCreateAccount(false);
                  setMessage("");
                }}
                style={{
                  width: "100%",
                  padding: 15,
                  borderRadius: S.radiusMd,
                  border: "none",
                  background: "#EEF0F4",
                  color: "#1C1C1E",
                  fontSize: 16,
                  fontWeight: 600,
                  cursor: "pointer",
                  transition: "background 0.15s",
                }}
              >
                Back to Login
              </button>
            </div>
          ) : (
            <>
              <div
                style={{
                  background: "rgba(255,255,255,0.95)",
                  borderRadius: S.radiusMd,
                  border: "1px solid rgba(16,24,40,0.07)",
                  boxShadow:
                    "0 1px 3px rgba(16,24,40,0.05)",
                  marginBottom: 14,
                  overflow: "hidden",
                  transition:
                    "box-shadow 0.2s, border-color 0.2s",
                }}
              >
                {loginStep === 1 && (
                  <div
                    style={{
                      position: "relative",
                      display: "flex",
                      alignItems: "center",
                    }}
                  >
                    <span
                      style={{
                        position: "absolute",
                        left: 14,
                        display: "flex",
                        color: "#98A2B3",
                        pointerEvents: "none",
                      }}
                    >
                      <svg
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M3 21h18" />
                        <path d="M5 21V7l8-4v18" />
                        <path d="M19 21V11l-6-4" />
                        <path d="M9 9h.01M9 12h.01M9 15h.01M9 18h.01" />
                      </svg>
                    </span>

                    <input
                      type="text"
                      placeholder="Institution name"
                      value={businessName}
                      onChange={(e) => {
                        setBusinessName(e.target.value);
                        setMessage("");
                      }}
                      onKeyDown={(e) =>
                        e.key === "Enter" && handleContinue()
                      }
                      style={{
                        width: "100%",
                        height: 52,
                        padding: "0 14px 0 42px",
                        border: "none",
                        outline: "none",
                        background: "transparent",
                        fontSize: 16,
                        color: "#1C1C1E",
                        boxSizing: "border-box",
                      }}
                      onFocus={(e) =>
                        (e.currentTarget.parentElement!.style.boxShadow =
                          S.ringBlue)
                      }
                      onBlur={(e) =>
                        (e.currentTarget.parentElement!.style.boxShadow =
                          "0 1px 3px rgba(16,24,40,0.05)")
                      }
                      autoFocus
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                    />
                  </div>
                )}

                {loginStep === 2 && (
                  <>
                    <div
                      style={{
                        position: "relative",
                        display: "flex",
                        alignItems: "center",
                      }}
                    >
                      <span
                        style={{
                          position: "absolute",
                          left: 14,
                          display: "flex",
                          color: "#98A2B3",
                          pointerEvents: "none",
                        }}
                      >
                        <svg
                          width="18"
                          height="18"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                          <circle cx="12" cy="7" r="4" />
                        </svg>
                      </span>

                      <input
                        name="username"
                        placeholder="Username"
                        value={username}
                        onChange={(e) => {
                          setUsername(e.target.value);
                          setMessage("");
                        }}
                        style={{
                          width: "100%",
                          height: 52,
                          padding: "0 14px 0 42px",
                          border: "none",
                          outline: "none",
                          background: "transparent",
                          fontSize: 16,
                          color: "#1C1C1E",
                          boxSizing: "border-box",
                        }}
                        onFocus={(e) =>
                          (e.currentTarget.parentElement!.style.boxShadow =
                            S.ringBlue)
                        }
                        onBlur={(e) =>
                          (e.currentTarget.parentElement!.style.boxShadow =
                            "0 1px 3px rgba(16,24,40,0.05)")
                        }
                        autoFocus
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck={false}
                      />
                    </div>

                    <div
                      style={{
                        height: 1,
                        background: "rgba(16,24,40,0.06)",
                        marginLeft: 42,
                      }}
                    />

                    <div
                      style={{
                        position: "relative",
                        display: "flex",
                        alignItems: "center",
                      }}
                    >
                      <span
                        style={{
                          position: "absolute",
                          left: 14,
                          display: "flex",
                          color: "#98A2B3",
                          pointerEvents: "none",
                        }}
                      >
                        <svg
                          width="18"
                          height="18"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <rect
                            x="3"
                            y="11"
                            width="18"
                            height="11"
                            rx="2"
                            ry="2"
                          />
                          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                        </svg>
                      </span>

                      <input
                        type={showPassword ? "text" : "password"}
                        placeholder="Password"
                        value={password}
                        onChange={(e) => {
                          setPassword(e.target.value);
                          setMessage("");
                        }}
                        onKeyDown={(e) =>
                          e.key === "Enter" && handleLogin()
                        }
                        style={{
                          width: "100%",
                          height: 52,
                          padding: "0 44px 0 42px",
                          border: "none",
                          outline: "none",
                          background: "transparent",
                          fontSize: 16,
                          color: "#1C1C1E",
                          boxSizing: "border-box",
                        }}
                        onFocus={(e) =>
                          (e.currentTarget.parentElement!.style.boxShadow =
                            S.ringBlue)
                        }
                        onBlur={(e) =>
                          (e.currentTarget.parentElement!.style.boxShadow =
                            "0 1px 3px rgba(16,24,40,0.05)")
                        }
                      />

                      <button
                        type="button"
                        onClick={() =>
                          setShowPassword(!showPassword)
                        }
                        tabIndex={-1}
                        style={{
                          position: "absolute",
                          right: 8,
                          background: "none",
                          border: "none",
                          cursor: "pointer",
                          color: "#98A2B3",
                          padding: 6,
                          display: "flex",
                          borderRadius: 8,
                        }}
                        title={
                          showPassword
                            ? "Hide password"
                            : "Show password"
                        }
                      >
                        {showPassword ? (
                          <svg
                            width="18"
                            height="18"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                            <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                            <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
                            <line
                              x1="1"
                              y1="1"
                              x2="23"
                              y2="23"
                            />
                          </svg>
                        ) : (
                          <svg
                            width="18"
                            height="18"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                            <circle cx="12" cy="12" r="3" />
                          </svg>
                        )}
                      </button>
                    </div>
                  </>
                )}
              </div>

              {message && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    background: "#FFEFEE",
                    color: "#D93025",
                    border:
                      "1px solid rgba(255,59,48,0.18)",
                    borderRadius: S.radiusSm,
                    padding: "10px 12px",
                    marginBottom: 14,
                    fontSize: 13.5,
                    fontWeight: 500,
                    animation: "shake 0.3s ease",
                  }}
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    style={{ flexShrink: 0 }}
                  >
                    <circle cx="12" cy="12" r="10" />
                    <line
                      x1="12"
                      y1="8"
                      x2="12"
                      y2="12"
                    />
                    <line
                      x1="12"
                      y1="16"
                      x2="12.01"
                      y2="16"
                    />
                  </svg>

                  <span>{message}</span>
                </div>
              )}

              {loginStep === 1 ? (
                <LoadingButton
                  loading={loading}
                  loadingLabel="Checking…"
                  onClick={handleContinue}
                >
                  Continue
                </LoadingButton>
              ) : (
                <>
                  <LoadingButton
                    loading={loading}
                    loadingLabel="Signing in…"
                    onClick={handleLogin}
                    style={{ boxShadow: S.shadowBtn }}
                  >
                    Login
                  </LoadingButton>

                  <button
                    onClick={() => {
                      setLoginStep(1);
                      setMessage("");
                      setPublicSettings(null);
                    }}
                    style={{
                      width: "100%",
                      padding: 14,
                      marginTop: 4,
                      borderRadius: S.radiusMd,
                      border: "none",
                      background: "transparent",
                      color: MEDICAL_BLUE,
                      fontSize: 15,
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    ← Different institution
                  </button>
                </>
              )}
            </>
          )}
        </div>
      </div>

      {appVersion && (
        <div
          style={{
            position: "absolute",
            bottom: 14,
            width: "100%",
            textAlign: "center",
            color:
              loginStep === 2 &&
              publicSettings?.login_background
                ? "rgba(255,255,255,0.75)"
                : "#98A2B3",
            fontSize: 12,
            fontFamily: iosFont,
            pointerEvents: "none",
            zIndex: 1,
          }}
        >
          Version {appVersion}
        </div>
      )}

      <button
        onClick={() => setShowCreateAccount(true)}
        style={{
          position: "absolute",
          bottom: 32,
          left: 32,
          width: 54,
          height: 54,
          borderRadius: "50%",
          border: "none",
          background: "rgba(255,255,255,0.92)",
          backdropFilter: "blur(10px)",
          boxShadow: "0 6px 18px rgba(16,24,40,0.14)",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 10,
          transition: "transform 0.15s " + S.ease,
        }}
        onMouseEnter={(e) =>
          (e.currentTarget.style.transform = "scale(1.06)")
        }
        onMouseLeave={(e) =>
          (e.currentTarget.style.transform = "scale(1)")
        }
        title="Create Account"
      >
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke={MEDICAL_BLUE}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="8.5" cy="7" r="4" />
          <line x1="20" y1="8" x2="20" y2="14" />
          <line x1="23" y1="11" x2="17" y2="11" />
        </svg>
      </button>
    </div>
  );
}

