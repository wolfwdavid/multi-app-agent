"""Multi-App Agent — Hugging Face Space entry point (placeholder UI until the agent lands)."""

import gradio as gr

APPS = ["App 1", "App 2", "App 3"]


def run_agent(task: str) -> str:
    if not task.strip():
        return "Enter a task for the agent."
    steps = [f"{i}. [{app}] pending" for i, app in enumerate(APPS, start=1)]
    return f"Task: {task}\n\nPlan (stub):\n" + "\n".join(steps)


with gr.Blocks(title="Multi-App Agent") as demo:
    gr.Markdown("# Multi-App Agent\nA multi-step AI agent that acts across 3+ external apps.")
    task = gr.Textbox(label="Task", placeholder="Describe what the agent should do…")
    out = gr.Textbox(label="Agent trace", lines=10)
    gr.Button("Run", variant="primary").click(run_agent, task, out)

if __name__ == "__main__":
    demo.launch()
