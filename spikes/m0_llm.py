# /// script
# requires-python = ">=3.12"
# dependencies = ["pydantic-ai-slim[openai]", "pillow"]
# ///
"""M0 spike: deepseek-flash 经 pydantic-ai 的结构化输出 / function calling / 图片输入。

uv run spikes/m0_llm.py   (需要 .env 里的 DEEPSEEK_API_KEY)
"""

import io
import os
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
from pydantic import BaseModel
from pydantic_ai import Agent, BinaryContent, PromptedOutput
from pydantic_ai.models.openai import OpenAIChatModel
from pydantic_ai.providers.openai import OpenAIProvider

for line in (Path(__file__).parent.parent / ".env").read_text().splitlines():
    k, _, v = line.partition("=")
    os.environ.setdefault(k, v)

model = OpenAIChatModel(
    "deepseek-flash",
    provider=OpenAIProvider(base_url="https://api.deepseek.com", api_key=os.environ["DEEPSEEK_API_KEY"]),
)


class Decision(BaseModel):
    decision: str
    alternatives_considered: list[str]
    rationale: str


class Section(BaseModel):
    subsystem: str
    work_done: str
    problems: list[str]
    decisions: list[Decision]
    test_results: str | None


class NotebookEntry(BaseModel):
    attendees: list[str]
    goals: list[str]
    sections: list[Section]
    next_steps: list[str]


MESSAGES = """\
[<@111>] 今天调 intake，原来 REV 的轮子太滑，球老是吸不进来
[<@222>] 试了 goBILDA 的 gripper wheel 和 compliant wheel，compliant 吸得最稳，10 次成功 9 次
[<@111>] 那就定 compliant 了，下次把转速从 0.8 降到 0.6 试试，现在有点打飞
"""

calls: list[str] = []
agent = Agent(
    model,
    # deepseek-flash 的 thinking 模式不支持强制 tool_choice，也不支持 json_schema response_format，
    # 所以用 PromptedOutput（schema 写进 prompt，pydantic 校验 + 重试）。换 provider 时可改回默认 ToolOutput。
    output_type=PromptedOutput(NotebookEntry),
    system_prompt="Turn FTC team chat into an English engineering notebook entry. "
    "Resolve <@id> mentions with get_member. Only state facts present in the messages.",
)


@agent.tool_plain
def get_member(discord_id: str) -> str:
    """Resolve a Discord user id (digits only) to the member's real name."""
    calls.append(discord_id)
    return {"111": "Alice Chen", "222": "Bob Li"}.get(discord_id.strip("<@>"), "unknown")


def check_structured_and_tools() -> None:
    entry = agent.run_sync(MESSAGES).output
    print(entry.model_dump_json(indent=2))
    assert calls, "模型没有调用 get_member"
    assert {"Alice Chen", "Bob Li"} <= set(entry.attendees), entry.attendees
    assert any(d for s in entry.sections for d in s.decisions), "没有提取到 decision"
    print("✅ 结构化输出 + function calling")


def check_vision() -> None:
    img = Image.new("RGB", (800, 400), "white")
    d = ImageDraw.Draw(img)
    d.ellipse((50, 100, 250, 300), fill="red")
    d.text((320, 170), "kP = 0.027", fill="black", font=ImageFont.load_default(size=60))
    buf = io.BytesIO()
    img.save(buf, "JPEG")
    out = Agent(model).run_sync(
        ["What shape and color is on the left, and what text is on the right?",
         BinaryContent(buf.getvalue(), media_type="image/jpeg")]
    ).output
    print(out)
    assert "0.027" in out and "red" in out.lower(), out
    print("✅ 图片输入")


if __name__ == "__main__":
    check_structured_and_tools()
    check_vision()
