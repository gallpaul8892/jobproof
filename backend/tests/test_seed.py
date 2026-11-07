import json

import pytest

from app.seed.__main__ import main


def test_seed_is_a_noop_that_says_so(capsys: pytest.CaptureFixture[str]) -> None:
    main()
    line = json.loads(capsys.readouterr().out.strip())
    assert line["msg"] == "nothing to seed"
    assert line["logger"] == "jobproof.seed"
