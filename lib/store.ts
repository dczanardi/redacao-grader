type Submission = {
  id: string; user_id: string; rubric: string; proposta: string;
  upload_name: string; ocr_text: string; created_at: number;
};
type Report = {
  id: string; submission_id: string; score_0_100: number;
  json_result: any; html: string; created_at: number;
};
const SUBS: Submission[] = [];
const REPS: Report[] = [];
export function saveSubmission(s: Omit<Submission, "id"|"created_at">) {
  const sub: Submission = { id: String(Date.now()), created_at: Date.now(), ...s };
  SUBS.push(sub); return sub;
}
export function saveReport(r: Omit<Report, "id"|"created_at">) {
  const rep: Report = { id: String(Date.now()), created_at: Date.now(), ...r };
  REPS.push(rep); return rep;
}
export function getReportById(id: string) { return REPS.find(r => r.id === id); }
