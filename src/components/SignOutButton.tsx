import { useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { logOut } from "~/server/auth";
import { quietButton } from "~/components/Shell";

export function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <button
      type="button"
      className={quietButton}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await logOut();
        } catch {
          // Nothing to say: signing out locally still matters.
        }
        await router.invalidate();
        // A full load makes sure the cleared cookie is what the next request sees.
        window.location.assign("/");
      }}
    >
      Sign out
    </button>
  );
}
