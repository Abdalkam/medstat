// src/components/LiveSidebar.tsx

import type { Participant } from "../types";

interface Props {
    participants: Participant[];
    role: "trainer" | "trainee";
    allowAudio: (id: string) => void;
    muteUser: (id: string) => void;
    timeAgo: (time: number) => string;
}

export default function LiveSidebar({
    participants,
    role,
    allowAudio,
    muteUser,
    timeAgo
}: Props) {

    const raisedHands = participants.filter(user => user.handRaised);
    const speakers = participants.filter(user => user.speaking);

    return (
        <aside className="live-sidebar">
            {/* PARTICIPANTS */}
            <div className="sidebar-card">
                <h3>👥 Participants ({participants.length})</h3>
                {participants.map(user => (
                    <div key={user.id} className="sidebar-user">
                        <span>
                            {user.speaking ? "🎤" : "🔇"} {" "} {user.username}
                        </span>
                    </div>
                ))}
            </div>

            {/* TRAINER ONLY CONTROLS */}
            {role === "trainer" && (
                <>
                    <div className="sidebar-card">
                        <h3>✋ Raised Hands ({raisedHands.length})</h3>
                        {raisedHands.length === 0 ? (
                            <p>No requests</p>
                        ) : (
                            raisedHands.map(user => (
                                <div key={user.id} className="sidebar-hand">
                                    <div>
                                        <strong>✋ {user.username}</strong>
                                        <small>
                                            🕒 {" "} {timeAgo(user.lastHandRaiseTime)}
                                        </small>
                                    </div>
                                    <button 
                                        className="mic-button" 
                                        onClick={() => allowAudio(user.id)} 
                                        title="Allow microphone"
                                    >
                                        🎤
                                    </button>
                                </div>
                            ))
                        )}
                    </div>

                    <div className="sidebar-card">
                        <h3>🎤 Active Speakers ({speakers.length})</h3>
                        {speakers.map(user => (
                            <div key={user.id} className="sidebar-user">
                                <span>🟢 {user.username}</span>
                                <button 
                                    className="mute-button" 
                                    onClick={() => muteUser(user.id)} 
                                    title="Mute learner"
                                >
                                    🔇
                                </button>
                            </div>
                        ))}
                    </div>
                </>
            )}

            {/* LEARNER VIEW */}
            {role === "trainee" && (
                <div className="sidebar-card">
                    <h3>✋ Classroom</h3>
                    <p>Raise your hand to speak</p>
                </div>
            )}
        </aside>
    );
}