#!/usr/bin/env python3
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import sys
import time

EXTRACTION = {
    "characters": [
        {
            "id": "ye-xiao-wei",
            "name": "叶小伟",
            "aliases": ["小伟"],
            "role_summary": "从原文中抽取的穿越者主角，醒来后需要确认所处世界与自身处境。",
            "motivation": "确认自己为什么来到陌生地点，并寻找回到稳定处境的线索。",
            "knowledge_boundary": "叶小伟只知道自己醒来后的直接观察，不能知道未经历章节中的世界规则。",
            "confidence": 0.93,
            "evidence": [
                {
                    "text": "第1章 这是哪里：叶小伟从陌生环境中醒来，开始判断自身处境。",
                    "source_path": "import/chapters/test-novel-txt/0001-chapter-0001.md",
                    "chapter": "第1章 这是哪里",
                    "timepoint": "0001",
                }
            ],
        }
    ],
    "world_cards": [
        {
            "id": "source-station",
            "title": "源初车站",
            "summary": "连接原世界与异世界的异常空间，角色醒来后首先接触到它的痕迹。",
            "confidence": 0.84,
            "evidence": [{"text": "陌生环境与转移痕迹共同构成源初车站设定。", "chapter": "第1章 这是哪里"}],
        }
    ],
    "rule_cards": [
        {
            "id": "knowledge-boundary",
            "title": "穿越后知识边界",
            "rule": "角色只能依据已经历章节和个人记忆行动，不能直接得知未出现的世界事实。",
            "constraints": ["推演时必须先检查章节记忆。", "未被证据支持的世界规则必须进入 warnings。"],
            "confidence": 0.88,
            "evidence": [{"text": "叶小伟醒来后只凭眼前信息判断处境。", "chapter": "第1章 这是哪里"}],
        }
    ],
    "skills": [
        {
            "agent_id": "ye-xiao-wei",
            "file_name": "character-decision.md",
            "intent": "character-decision",
            "target": "simulation/logs",
            "mode": "append",
            "scope": "character",
            "consistency": "ooc",
            "body": "叶小伟行动前必须引用当前章节证据、知识边界和源初车站相关设定。",
        }
    ],
    "warnings": ["源初车站的完整规则证据不足，需要后续章节确认。"],
}

class Handler(BaseHTTPRequestHandler):
    def _json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            self._json(200, {"status": "ok", "service": "novelfabric-local-llm-provider"})
        else:
            self._json(404, {"error": "not found"})

    def do_POST(self):
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length).decode("utf-8", errors="replace")
        try:
            request = json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            request = {}
        model = str(request.get("model", ""))
        if self.path.endswith("/chat/completions"):
            if "timeout" in model:
                time.sleep(5)
                self._json(200, {"choices": [{"message": {"role": "assistant", "content": "late timeout response"}}]})
                return
            if "auth-failure" in model:
                self._json(401, {"error": {"type": "auth", "message": "local provider rejected the API key"}})
                return
            if "model-not-found" in model:
                self._json(404, {"error": {"type": "model_not_found", "message": f"model {model} was not found"}})
                return
            if "provider-5xx" in model:
                self._json(500, {"error": {"type": "server_error", "message": "local provider forced 5xx failure"}})
                return
            if "请从小说文本中提取" in raw:
                content = "{invalid semantic extraction json" if "invalid-schema" in model else json.dumps(EXTRACTION, ensure_ascii=False)
            else:
                content = "NovelFabric LLM healthcheck OK"
            self._json(200, {"choices": [{"message": {"role": "assistant", "content": content}}]})
        else:
            self._json(404, {"error": "not found"})

    def log_message(self, fmt, *args):
        print(fmt % args, file=sys.stderr)

if __name__ == "__main__":
    host = "127.0.0.1"
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 50112
    print(f"local llm provider ready on http://{host}:{port}/v1", flush=True)
    ThreadingHTTPServer((host, port), Handler).serve_forever()
