import { redirect } from "next/navigation";

/** 个人通道默认落地 Agent 导演页（对齐同行：默认页 = Agent）。 */
export default function PersonalHomePage() {
  redirect("/personal/agent");
}
