import { Link } from "react-router-dom";
import { LockKeyhole, ArrowLeft } from "lucide-react";
import AuthLayout from "../components/AuthLayout";
export default function ForgotPassword() {
  return (
    <AuthLayout>
      <div className="empty-icon">
        <LockKeyhole size={24} />
      </div>
      <h2>Let’s get you back in.</h2>
      <p>
        Self-service password recovery is not available in this research
        deployment. Contact your workspace administrator to restore access to
        your account.
      </p>
      <div className="notice">
        If you can still sign in, you can change your password in Account
        settings → Change password.
      </div>
      <Link className="btn btn-primary" to="/login">
        <ArrowLeft size={15} />
        Back to sign in
      </Link>
    </AuthLayout>
  );
}
