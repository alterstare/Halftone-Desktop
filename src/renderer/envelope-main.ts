// Entry of envelope.html (음성 플레이어): Envelope's renderer lives in
// src/envelope (outside the renderer root), so the page loads it through this
// module — a <script src="../envelope/…"> would point outside the dev
// server's root.
import '../envelope/renderer/src/main'
