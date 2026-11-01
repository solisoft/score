# The site's words in English and French (#471), from config/locales/*.yml,
# for services and controllers. Views use `t()`, which reads the same files
# as Soli loads them at boot; this reads them itself, so a model spec — run
# outside the server, where nothing is loaded — gets the same words.

# `tree`'s leaves as "prefix.key.sub" => text.
def _site_text_flatten(tree, prefix, into)
  for key in tree.keys
    value = tree[key]
    path = prefix.blank? ? key.to_s : "#{prefix}.#{key}"
    if type(value) == "hash"
      _site_text_flatten(value, path, into)
    else
      into[path] = value.to_s
    end
  end
  into
end

def _site_text_load
  texts = {}
  for locale in ["en", "fr"]
    _site_text_flatten(Yaml.parse(slurp("config/locales/#{locale}.yml")), "", texts)
  end
  texts
end

const SITE_TEXTS = _site_text_load()

class SiteText
  # `key` in `locale` (the request's when nil), its {name}s replaced by `vars`.
  static def t(key, vars = {}, locale = nil)
    text = I18n.translate(key, locale ?? I18n.locale(), SITE_TEXTS)
    for name in vars.keys
      text = text.replace("{#{name}}", vars[name].to_s)
    end
    text
  end
end
