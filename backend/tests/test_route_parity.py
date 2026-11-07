from app.main import create_app
from tests.contract import NOT_YET_IMPLEMENTED, contract_operations

_HTTP_METHODS = {"get", "put", "post", "delete", "patch"}


def test_server_routes_match_the_contract() -> None:
    # FastAPI's own schema is never served (openapi_url=None) but is still a public way to
    # list the routes the app really registered, whatever router nesting is used.
    paths = create_app().openapi()["paths"]
    served = {
        (method.upper(), path)
        for path, item in paths.items()
        for method in item
        if method in _HTTP_METHODS
    }
    expected = set(contract_operations()) - NOT_YET_IMPLEMENTED
    assert served == expected


def test_not_yet_implemented_only_lists_contract_operations() -> None:
    assert set(contract_operations()) >= NOT_YET_IMPLEMENTED
