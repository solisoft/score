# What a page hands its inline script, under the Content-Security-Policy
# (#544, app/services/content_policy.sl). An inline script runs only if its
# text hashes to one the policy names, so its text never changes with the
# page: the values it needs — words, addresses, a revision — come in a JSON
# block beside it, which the browser does not run, and the script reads
# them with `JSON.parse(document.getElementById(id).textContent)`.

# A `<script type="application/json" id="…">` block holding `value`, as
# json_for_script writes it (#537: `<`, U+2028, U+2029 escaped), `>` and `&`
# too, so a value that holds "</script>" can neither close the block nor
# open a tag.
def page_data(id, value)
  json = json_for_script(value).replace(">", "\\u003e").replace("&", "\\u0026")
  "<script type=\"application/json\" id=\"#{id}\">#{json}</script>"
end
