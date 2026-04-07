from services.llm.providers import (
    create_llm_client,
    estimate_cost,
    PROVIDER_REGISTRY,
)


def test_provider_registry_has_entries():
    assert len(PROVIDER_REGISTRY) >= 2


def test_create_llm_client_default():
    client = create_llm_client("openai_gpt4o")
    assert client.default_model == "gpt-4o"


def test_create_llm_client_invalid():
    try:
        create_llm_client("nonexistent_provider")
        assert False, "Should have raised ValueError"
    except ValueError:
        pass


def test_estimate_cost():
    cost = estimate_cost("openai_gpt4o", input_tokens=1000, output_tokens=500)
    assert cost > 0


def test_estimate_cost_unknown_provider():
    cost = estimate_cost("unknown", input_tokens=1000, output_tokens=500)
    assert cost == 0.0
