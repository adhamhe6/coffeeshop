"""Request parsers that turn hostile bodies into 400s instead of unhandled exceptions."""

from rest_framework.exceptions import ParseError
from rest_framework.parsers import JSONParser


class SafeJSONParser(JSONParser):
    """JSON parser that reports absurdly deep nesting (which exhausts the interpreter's recursion limit) as a 400."""

    def parse(self, stream, media_type=None, parser_context=None):
        try:
            return super().parse(stream, media_type, parser_context)
        except RecursionError:
            raise ParseError("JSON is nested too deeply.") from None
