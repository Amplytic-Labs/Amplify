import katex from 'katex';
import { mml2omml as mathmlToOmml } from 'mathml2omml';
import { postProcessOmml } from './omml-postprocess';

/**
 * Convert a LaTeX expression to OMML (Office Math Markup Language)
 * so it appears as a native equation inside the .docx file.
 *
 * Pipeline: LaTeX → (KaTeX) → MathML → (mathml2omml) → OMML
 *           → (post-process) → clean OMML
 *
 * The post-processing step fixes several `mathml2omml` shortcomings
 * that produce ugly rendering in Word: invisible operator chars left in
 * text runs, function names not marked upright, empty `<m:e/>`
 * placeholders from n-ary operators, and small (non-growing) brackets
 * around fractions / matrices / piecewise functions. See
 * `omml-postprocess.ts` for the full list.
 */
export function latexToOmml(latex: string, displayMode: boolean): string | null {
  try {
    const html = katex.renderToString(latex, {
      displayMode,
      throwOnError: false,
      output: 'mathml',
      strict: false,
    });
    const match = html.match(/<math[\s\S]*?<\/math>/);

    if (!match) {
      return null;
    }

    /*
     * KaTeX wraps the presentation MathML in a <semantics> element along
     * with an <annotation> containing the original LaTeX source. We need
     * to keep the presentation MathML but drop both the <annotation> and
     * the <semantics> wrapper tags themselves.
     *
     * NB: a previous version used `<semantics>…</semantics>` which
     * greedily removed the inner MathML too — for simple expressions
     * the fallback below rescued it, but for `cases`/`mtable` the
     * fallback didn't trigger correctly and mathml2omml returned an
     * empty <m:oMath/>. Stripping only <annotation> + unwrapping the
     * <semantics> tags fixes that.
     */
    const mathml = match[0].replace(/<annotation[\s\S]*?<\/annotation>/g, '').replace(/<\/?semantics>/g, '');
    const omml = mathmlToOmml(mathml);

    if (!omml || typeof omml !== 'string') {
      return null;
    }

    return postProcessOmml(omml);
  } catch (e) {
    return null;
  }
}
