import { Suspense } from "react";
import { AccountsClient } from "./AccountsClient";
import { Loading } from "../components/Card";
export const metadata = { title: "Accounts" };
export default function AccountsPage() {
  return (
    <Suspense fallback={<Loading />}>
      <AccountsClient />
    </Suspense>
  );
}
