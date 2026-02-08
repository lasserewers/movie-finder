import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "../hooks/useAuth";
import { changeEmail, changePassword, deleteAccount } from "../api/auth";
import { ApiError } from "../api/client";

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function ProfileModal({ open, onClose }: Props) {
  const { user, logout } = useAuth();

  const [emailPassword, setEmailPassword] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [emailMsg, setEmailMsg] = useState("");
  const [emailErr, setEmailErr] = useState("");
  const [emailLoading, setEmailLoading] = useState(false);

  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pwMsg, setPwMsg] = useState("");
  const [pwErr, setPwErr] = useState("");
  const [pwLoading, setPwLoading] = useState(false);

  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deletePw, setDeletePw] = useState("");
  const [deleteErr, setDeleteErr] = useState("");
  const [deleteLoading, setDeleteLoading] = useState(false);

  const resetFields = () => {
    setEmailPassword("");
    setNewEmail("");
    setEmailMsg("");
    setEmailErr("");
    setCurrentPw("");
    setNewPw("");
    setConfirmPw("");
    setPwMsg("");
    setPwErr("");
    setDeleteConfirm(false);
    setDeletePw("");
    setDeleteErr("");
  };

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setEmailMsg("");
    setEmailErr("");
    setEmailLoading(true);
    try {
      const result = await changeEmail(emailPassword, newEmail);
      setEmailMsg(`Confirmation sent to ${result.pending_email}. Open that inbox and confirm the change.`);
      setEmailPassword("");
      setNewEmail("");
    } catch (err) {
      setEmailErr(err instanceof ApiError ? err.message : "Failed to update email");
    } finally {
      setEmailLoading(false);
    }
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwMsg("");
    setPwErr("");
    if (newPw !== confirmPw) {
      setPwErr("Passwords do not match");
      return;
    }
    setPwLoading(true);
    try {
      await changePassword(currentPw, newPw);
      setPwMsg("Password updated");
      setCurrentPw("");
      setNewPw("");
      setConfirmPw("");
    } catch (err) {
      setPwErr(err instanceof ApiError ? err.message : "Failed to update password");
    } finally {
      setPwLoading(false);
    }
  };

  const handleDeleteAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setDeleteErr("");
    setDeleteLoading(true);
    try {
      await deleteAccount(deletePw);
      logout();
      onClose();
    } catch (err) {
      setDeleteErr(err instanceof ApiError ? err.message : "Failed to delete account");
    } finally {
      setDeleteLoading(false);
    }
  };

  const inputClass =
    "w-full px-3 py-2.5 text-sm border border-border rounded-lg bg-bg-2 text-text outline-none focus:border-accent-2 transition-colors";

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[340] flex items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={(e) => e.target === e.currentTarget && onClose()}
        >
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
          <motion.div
            className="relative bg-panel border border-border rounded-2xl w-[min(92vw,440px)] max-h-[86vh] flex flex-col"
            initial={{ scale: 0.95, y: 20 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.95, y: 20 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between p-8 pb-0">
              <div>
                <h3 className="font-display text-xl">Profile</h3>
                <p className="text-sm text-muted mt-2">{user?.email}</p>
              </div>
              <button
                onClick={onClose}
                className="w-9 h-9 rounded-full border border-border text-text text-xl flex items-center justify-center hover:border-accent-2 transition-colors flex-shrink-0"
              >
                &times;
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-8 pt-4">
            {/* Change Email */}
            <form onSubmit={handleEmailSubmit} className="flex flex-col gap-3 mb-8">
              <h4 className="text-sm font-semibold text-text">Change email</h4>
              <input
                type="password"
                required
                placeholder="Current password"
                value={emailPassword}
                onChange={(e) => setEmailPassword(e.target.value)}
                autoComplete="current-password"
                className={inputClass}
              />
              <input
                type="email"
                required
                placeholder="New email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                autoComplete="email"
                className={inputClass}
              />
              {emailErr && (
                <div className="text-sm text-red-400 bg-red-400/10 rounded-lg px-3 py-2">{emailErr}</div>
              )}
              {emailMsg && (
                <div className="text-sm text-green-400 bg-green-400/10 rounded-lg px-3 py-2">{emailMsg}</div>
              )}
              <button
                type="submit"
                disabled={emailLoading}
                className="w-full py-2.5 font-semibold rounded-lg bg-accent text-white hover:bg-accent/85 transition-colors disabled:opacity-50 text-sm"
              >
                {emailLoading ? "..." : "Update email"}
              </button>
            </form>

            {/* Change Password */}
            <form onSubmit={handlePasswordSubmit} className="flex flex-col gap-3">
              <h4 className="text-sm font-semibold text-text">Change password</h4>
              <input
                type="password"
                required
                placeholder="Current password"
                value={currentPw}
                onChange={(e) => setCurrentPw(e.target.value)}
                autoComplete="current-password"
                className={inputClass}
              />
              <input
                type="password"
                required
                minLength={8}
                placeholder="New password"
                value={newPw}
                onChange={(e) => setNewPw(e.target.value)}
                autoComplete="new-password"
                className={inputClass}
              />
              <input
                type="password"
                required
                minLength={8}
                placeholder="Confirm new password"
                value={confirmPw}
                onChange={(e) => setConfirmPw(e.target.value)}
                autoComplete="new-password"
                className={inputClass}
              />
              {pwErr && (
                <div className="text-sm text-red-400 bg-red-400/10 rounded-lg px-3 py-2">{pwErr}</div>
              )}
              {pwMsg && (
                <div className="text-sm text-green-400 bg-green-400/10 rounded-lg px-3 py-2">{pwMsg}</div>
              )}
              <button
                type="submit"
                disabled={pwLoading}
                className="w-full py-2.5 font-semibold rounded-lg bg-accent text-white hover:bg-accent/85 transition-colors disabled:opacity-50 text-sm"
              >
                {pwLoading ? "..." : "Update password"}
              </button>
            </form>

            {/* Delete Account */}
            <div className="mt-10 pt-6 border-t border-border">
              <h4 className="text-sm font-semibold text-red-400 mb-2">Delete account</h4>
              {!deleteConfirm ? (
                <button
                  onClick={() => setDeleteConfirm(true)}
                  className="w-full py-2.5 font-semibold rounded-lg border border-red-500/50 text-red-400 hover:bg-red-500/10 transition-colors text-sm"
                >
                  Delete my account
                </button>
              ) : (
                <form onSubmit={handleDeleteAccount} className="flex flex-col gap-3">
                  <p className="text-sm text-muted">
                    This will permanently delete your account and all your data. This action cannot be undone.
                  </p>
                  <input
                    type="password"
                    required
                    placeholder="Enter your password to confirm"
                    value={deletePw}
                    onChange={(e) => setDeletePw(e.target.value)}
                    autoComplete="current-password"
                    className={inputClass}
                  />
                  {deleteErr && (
                    <div className="text-sm text-red-400 bg-red-400/10 rounded-lg px-3 py-2">{deleteErr}</div>
                  )}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setDeleteConfirm(false);
                        setDeletePw("");
                        setDeleteErr("");
                      }}
                      className="flex-1 py-2.5 font-semibold rounded-lg border border-border text-text hover:bg-white/5 transition-colors text-sm"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={deleteLoading}
                      className="flex-1 py-2.5 font-semibold rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-50 text-sm"
                    >
                      {deleteLoading ? "..." : "Delete forever"}
                    </button>
                  </div>
                </form>
              )}
            </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
