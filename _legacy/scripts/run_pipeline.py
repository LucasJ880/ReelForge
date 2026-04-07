"""运行指定的 Pipeline"""

import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from pipelines.project_intake import ProjectIntakePipeline
from pipelines.research_analysis import ResearchAnalysisPipeline
from pipelines.script_generation import ScriptGenerationPipeline
from pipelines.video_generation import VideoGenerationPipeline
from pipelines.qa_review import QAReviewPipeline
from pipelines.delivery import DeliveryPipeline
from pipelines.feedback_loop import FeedbackLoopPipeline

PIPELINES = {
    "project_intake": ProjectIntakePipeline,
    "research_analysis": ResearchAnalysisPipeline,
    "script_generation": ScriptGenerationPipeline,
    "video_generation": VideoGenerationPipeline,
    "qa_review": QAReviewPipeline,
    "delivery": DeliveryPipeline,
    "feedback_loop": FeedbackLoopPipeline,
}


async def run(pipeline_name: str, input_data: dict):
    pipeline_cls = PIPELINES.get(pipeline_name)
    if not pipeline_cls:
        print(f"Unknown pipeline: {pipeline_name}")
        print(f"Available: {list(PIPELINES.keys())}")
        sys.exit(1)

    pipeline = pipeline_cls()
    print(f"Running pipeline: {pipeline_name}")
    print(f"Input: {json.dumps(input_data, indent=2, ensure_ascii=False)}")

    result = await pipeline.run(input_data)

    print(f"\nStatus: {result.status}")
    print(f"Run ID: {result.run_id}")
    print(f"Steps:")
    for step in result.steps:
        print(f"  - {step.name}: {step.status.value}")
        if step.error:
            print(f"    Error: {step.error}")

    print(f"\nFinal Output:")
    print(json.dumps(result.final_output, indent=2, default=str, ensure_ascii=False))


def main():
    if len(sys.argv) < 2:
        print("Usage: python run_pipeline.py <pipeline_name> [--input '<json>']")
        print(f"Available pipelines: {list(PIPELINES.keys())}")
        sys.exit(1)

    pipeline_name = sys.argv[1]
    input_data = {}

    if "--input" in sys.argv:
        idx = sys.argv.index("--input")
        if idx + 1 < len(sys.argv):
            input_data = json.loads(sys.argv[idx + 1])

    asyncio.run(run(pipeline_name, input_data))


if __name__ == "__main__":
    main()
