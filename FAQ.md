# Frequently Asked Questions (FAQ)

<details>
<summary><strong>What are the best models for Amplify?</strong></summary>

For the best experience with Amplify, we recommend using the following models:

- **Claude Sonnet 5 / Claude Opus 4.8**: Best overall coders — 1M-token context window  on the API, strong at multi-file edits, tool use, and long agentic sessions. Sonnet 5 is the faster/cheaper default; Opus 4.8 is worth it for the hardest refactors and architecture decisions.
- **Gemini 3.1 Pro**: Leads on long-context and reasoning tasks with a 1M+ token context window,  and remains a very fast, capable option.
- **GPT-5.5 / GPT-5.6**: Strong all-rounder, comparable coding capability to Claude/Gemini, large ecosystem and tooling support.
- **DeepSeek V4 Pro**: Best open-source pick if you want frontier-ish performance via API (OpenRouter, DeepSeek API) or self-hosting on a beefy cluster — V4 Pro ships with a 1M context window  and leads open-weight reasoning/agentic benchmarks.
- **Qwen3-Coder (30B)**: Best model for realistic self-hosting — it's the default local coding model, with a 256K-token context window, Apache 2.0 license, and quantized weights that fit on a single 24GB GPU. 

**Context window — how much do you actually need for "vibe coding"?**
- **Quick edits / single-file work**: 32K–64K tokens is plenty.
- **Whole small-to-medium repo in context, multi-file refactors, agentic back-and-forth (recommended for Amplify-style dev)**: aim for **200K tokens minimum**, ideally **500K–1M**. 1 million tokens is roughly 750,000 words — enough to hold an entire mid-sized codebase in a single prompt. 
- **Note**: real-world reliability drops well before the advertised limit — for most models, effective usable context is only around half of what's advertised, so don't assume a "1M" model reliably tracks details at the very edge of that window.
- Models under ~7B parameters still generally lack the reasoning depth to interact usefully with Amplify's codebase-level tasks.

</details>

<details>
<summary><strong>How do I get the best results with Amplify?</strong></summary>

- **Be specific about your stack**:  
  Mention the frameworks or libraries you want to use (e.g., Astro, Tailwind, ShadCN) in your initial prompt. This ensures that Amplify scaffolds the project according to your preferences.

- **Use the enhance prompt icon**:  
  Before sending your prompt, click the _enhance_ icon to let the AI refine your prompt. You can edit the suggested improvements before submitting.

- **Scaffold the basics first, then add features**:  
  Ensure the foundational structure of your application is in place before introducing advanced functionality. This helps Amplify establish a solid base to build on.

- **Batch simple instructions**:  
 Combine simple tasks into a single prompt to save time and reduce API credit consumption. For example:  
 _"Change the color scheme, add mobile responsiveness, and restart the dev server."_
</details>

<details>
<summary><strong>How do I contribute to Amplify?</strong></summary>

Check out our [Contribution Guide](CONTRIBUTING.md) for more details on how to get involved!

</details>

<details>
<summary><strong>What are the future plans for Amplify?</strong></summary>

We don't have a fixed roadmap — and that's intentional. As explained above, direction is set collaboratively through
strategic epics, decided by the core team in open discussion and shaped by whoever shows up to build.

That said, here's our north star: **we want Amplify to become the best open alternative in its space.**

Where exactly that leads is up to the community. If you have ideas, strong opinions, or a feature you're passionate
about, the best way to influence the direction is to:

- Check the [epics](https://github.com/Amplytic-Labs/Amplify/issues?q=state%3Aopen%20label%3Aepic) to see what's
  currently being prioritized
- Open an issue or join the discussion if you think something's missing
- Just start building — a well-executed PR speaks louder than a roadmap item

</details>

<details>
<summary><strong>How do local LLMs compare to larger models like Claude Opus 4.8 for Amplify?</strong></summary>

Honestly, classic local models are nowhere near frontier cloud models like Claude Opus 4.8, GPT-5.5, or Gemini 3.1
Pro for complex, agentic work — and that gap isn't closing as fast as people online might suggest. Most contributors
will realistically be able to self-host something in the ~40B parameter range with 128K–256K context, not a
frontier-scale model.

That said, at that size, local models can work well and get the job done — especially for smaller, well-scoped
tasks, simple edits, or when you're prioritizing privacy/cost over raw capability. They're not a drop-in replacement
for cloud models on hard, multi-file, agentic work, but they're far from useless.

Our ongoing focus is to improve prompts, agents, and the platform itself to get the most out of what a realistically
self-hostable model (~40B, 128K–256K context) can do — rather than assuming everyone has access to frontier-scale
compute.

</details>

<details>
<summary><strong>Common Errors and Troubleshooting</strong></summary>

### **"There was an error processing this request"**

This generic error message means something went wrong. Check both:

- The terminal (if you started the app with Docker or `pnpm`).
- The developer console in your browser (press `F12` or right-click > _Inspect_, then go to the _Console_ tab).

### **"x-api-key header missing"**

This error is sometimes resolved by restarting the Docker container.  
If that doesn't work, try switching from Docker to `pnpm` or vice versa. We're actively investigating this issue.

### **Blank preview when running the app**

A blank preview often occurs due to hallucinated bad code or incorrect commands.  
To troubleshoot:

- Check the developer console for errors.
- Remember, previews are core functionality, so the app isn't broken! We're working on making these errors more transparent.

### **"Everything works, but the results are bad"**

Local LLMs like Qwen-2.5-Coder are powerful for small applications but still experimental for larger projects. For better results, consider using larger models like GPT-4o, Claude 3.5 Sonnet, or DeepSeek Coder V2 236b.

### **"Received structured exception #0xc0000005: access violation"**

If you are getting this, you are probably on Windows. The fix is generally to update the [Visual C++ Redistributable](https://learn.microsoft.com/en-us/cpp/windows/latest-supported-vc-redist?view=msvc-170)

### **"Miniflare or Wrangler errors in Windows"**

You will need to make sure you have the latest version of Visual Studio C++ installed (14.40.33816).

</details>

---

Got more questions? Feel free to reach out or open an issue in our GitHub repo!
