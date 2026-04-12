import { Injectable, Logger } from "@nestjs/common";
import * as ExcelJS from "exceljs";
import {
  Session,
  StudentResult,
} from "../session/interfaces/session.interface";

@Injectable()
export class ExcelService {
  private readonly logger = new Logger(ExcelService.name);

  /**
   * Generates an in-memory Excel workbook for a completed test session.
   * Returns a Buffer ready to be sent as a Telegram document.
   */
  async generateResultsBuffer(session: Session): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    wb.creator = "Telegram Test Bot";
    wb.created = new Date();

    const ws = wb.addWorksheet("Results", {
      pageSetup: { fitToPage: true, orientation: "landscape" },
    });

    // ── Column definitions ────────────────────────────────────────────────────
    ws.columns = [
      { header: "F.I.SH", key: "fullName", width: 28 },
      { header: "Telegram ID", key: "username", width: 20 },
      { header: "Ball", key: "score", width: 10 },
      { header: "Maksimal Ball", key: "maxScore", width: 10 },
      { header: "%", key: "percent", width: 8 },
      { header: "To'gri javoblar", key: "correctCount", width: 10 },
      { header: "Xato javoblar", key: "wrongCount", width: 10 },
      { header: "Belgilanmagan", key: "missingCount", width: 10 },
      { header: "Topshirilgan javoblar", key: "rawAnswers", width: 45 },
      { header: "Topshirilgan vaqt", key: "submittedAt", width: 22 },
    ];

    // ── Style header row ──────────────────────────────────────────────────────
    const headerRow = ws.getRow(1);
    headerRow.font = { bold: true, size: 11 };
    headerRow.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF4472C4" },
    };
    headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
    headerRow.alignment = { vertical: "middle", horizontal: "center" };
    headerRow.height = 20;

    // ── Sort students by score descending ─────────────────────────────────────
    const students = [...session.students.values()].sort(
      (a, b) => b.score - a.score,
    );

    // ── Data rows ─────────────────────────────────────────────────────────────
    students.forEach((r, idx) => {
      const percent =
        r.maxScore > 0 ? Math.round((r.score / r.maxScore) * 100) : 0;

      const row = ws.addRow({
        fullName: r.fullName,
        username: r.username ? `@${r.username}` : "—",
        userId: r.userId,
        score: r.score,
        maxScore: r.maxScore,
        percent: `${percent}%`,
        correctCount: r.correctCount,
        wrongCount: r.wrongCount,
        missingCount: r.missingCount,
        rawAnswers: r.rawAnswers,
        submittedAt: new Date(r.submittedAt).toLocaleString("en-US", {
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }),
      });

      // Alternate row background for readability
      if (idx % 2 === 1) {
        row.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFF2F2F2" },
        };
      }

      row.alignment = { vertical: "middle" };
    });

    // ── Summary sheet ─────────────────────────────────────────────────────────
    const summaryWs = wb.addWorksheet("Summary");
    const total = students.length;
    const avgScore =
      total > 0 ? students.reduce((sum, s) => sum + s.score, 0) / total : 0;
    const maxPossible = students[0]?.maxScore ?? 0;

    summaryWs.addRow(["Test Name", session.testName]);
    summaryWs.addRow(["Session ID", session.sessionId]);
    summaryWs.addRow(["Created At", session.createdAt.toLocaleString()]);
    summaryWs.addRow(["Total Students", total]);
    summaryWs.addRow(["Average Score", avgScore.toFixed(2)]);
    summaryWs.addRow(["Max Possible Score", maxPossible]);
    summaryWs.addRow([
      "Scoring Rule",
      `+${session.scoring.pointsPerCorrect} correct / -${session.scoring.pointsPerWrong} wrong`,
    ]);

    summaryWs.getColumn(1).width = 22;
    summaryWs.getColumn(2).width = 35;

    // ── Generate buffer ───────────────────────────────────────────────────────
    const arrayBuffer = await wb.xlsx.writeBuffer();
    const buffer = Buffer.from(arrayBuffer);

    this.logger.log(
      `Excel generated for session ${session.sessionId}: ${total} rows, ${buffer.length} bytes`,
    );

    return buffer;
  }
}
