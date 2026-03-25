import { Suspense } from "react";
import AdminPanel from "./AdminPanel";

export default function AdminPage() {
  return (
    <Suspense fallback={null}>
      <AdminPanel />
    </Suspense>
  );
}
