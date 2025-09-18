---
layout: post
title:  "Poststructuralism and Language Models"
date:   2025-09-18 10:10:27 -0500
categories: jekyll update
author: William
tags: Philosophy
permalink: poststructuralism
description: an obituary for the turing test and what it means for us
excerpt_separator: <!--more-->
---

an obituary for the Turing test and what it means for us

<!--more-->

<blockquote>
<i>If they find a parrot who could answer to everything, I would claim it to be an intelligent being without hesitation</i> <br>

-Denis Diderot (1746)
</blockquote>

 In the early 20th century, the dominant framework of linguistic theory was **structuralism**, the notion that there existed signifiers (words) and the signified (their referents), and that meaning emerged from the arbitrary way our signifiers referred to reality.

 As the 20th century progressed, post-structuralist philosophers overthrew this framework and tore it to shreds. Meaning is not to be found in the relationship between a text and the world outside it, but rather in the relationship between text and other texts. The dictionary defines words in terms of other words, implying meaning emerges in a recursive network of similarities, oppositions, and connections between words rather than the way words reflect an outside world. This position was (in)famously advanced by the philosopher [**Jacques Derrida**](https://en.wikipedia.org/wiki/Jacques_Derrida), who declared in his magnum opus *On Grammatology* that "**there is nothing outside of the text**".

 This hypothesis, while regarded as deeply radical and controversial during Derrida's lifetime, has essentially been confirmed by the advent of language modeling. Without any knowledge of the outside world, LLMs reproduce the entire structure of human language purely from the statistical correlations and associations between words: the entire corpus of human knowledge compressed into a GPU using nothing outside the text.

<p style="text-align: center;">⁂</p>

It is quite rare that philosophical questions are resolved by empirical answers. Most philosophical questions are sufficiently ethereal and intangible that science never manages to latch its fingers onto them: think the existence of God or the objectivity of morality. But every once in a while, the scientific method manages to render an objective answer to a philosophical quandry. One famous example of such a resolution is **Molyneaux's problem**, which asks whether:

<blockquote>
<i> if a man born blind can feel the differences between shapes such as spheres and cubes, could he, if given the ability to see, distinguish those objects by sight alone, in reference to the tactile schemata he already possessed?</i> <br>

-Locke (1689)
 </blockquote>

This question was considered a major point of contention between [rationalists and empiricists](https://plato.stanford.edu/entries/rationalism-empiricism/), who argued that knowledge came from logical reasoning or sense data respectively. It was resolved [in favor of the empiricists](https://pubmed.ncbi.nlm.nih.gov/21478887/) in 2003 when neuroscience professor Pawan Sinha restored vision to subjects with total congenital blindness and tested subjects to see if they could distinguish objects visually as well as by touch. In the visual domain, the subjects performed barely better than guessing.

In hindsight, this result makes a large degree of intuitive sense from the hyper-empiricist standpoint of statistical learning theory. How would a person with newly restored vision after years of blindness have any intuition about what their senses are indicating? But it is also easy to see how absent this framework, such a question poses quite the dilemma.

Another example of this phenomenon is Einstein's theory of General Relativity. For a long time, there was extensive debate between the so called A and B theories of time. A theory, often referred to as **presentism**, posits that the past and future are unreal and only the present truly exists. B theory, often called **eternalism**, instead posits that the past, present, and future are all equally real.

In special relativity, the notion of simultaneity depends on your frame of reference, meaning that there is no universal notion of the present. In general relativity, simultaneity is even weaker, and is not only **relative** but **local**, meaning there is no notion of what is happening "now" for objects far away. This essentially kills off the A theory of time. Gravity emerging from the curvature of a unified block of spacetime hammers down the last nail in the coffin for presentism.

<p style="text-align: center;">⁂</p>

One direction I feel has not been explored nearly enough is how the nature of language models can provide new insight into long-standing issues in the philosophy of language. One such perrenial issue is the relationship between language and thought. The **Sapir-Whorf hypothesis** asserts that language influences the scope of human thought. The now debunked **strong hypothesis** asserts that language *determines* thought and that human reasoning can not extend beyond what language describes. The [Hopi language](https://en.wikipedia.org/wiki/Hopi_time_controversy), once a poster child for this notion, contains no explicit words for past and future and is very close to a tenseless language. Whorf believed that this showed that the Hopi have no notion of the flow of time, an idea that has been [empirically invalidated](https://books.google.com/books?hl=en&lr=&id=Orpzv3su5twC&oi=fnd&pg=PA1&dq=hopi+time&ots=jhTjctVdaj&sig=PWjdijLY9EM_C7Rvhb_BJQ8xSGc#v=onepage&q=hopi%20time&f=false), with the modern consensus being that the Hopi simply discuss time via spatial analogies, albeit in a slightly more event-based fashion.

On the other hand, the **weak hypothesis**, which posits that language use merely influences the way we think, has enjoyed some scant (and at times sketchy) empirical support and is still the subject of [great](https://youtu.be/5YXXGHwmogU) [controversy](https://youtu.be/CmZdGo6b5yA).

One interesting piece of evidence in favor of weak Sapir-Whorf is language mixing in LLMs. The tendency for bilingual language models to switch and mix languages selectively during reasoning was first observed in [DeepSeek-R1](https://arxiv.org/abs/2501.12948), where the authors discuss how they had to structure the reward function in order to prevent the model from mixing languages during reinforcement learning. Other RL trained thinking models such as OpenAI's o1 model have been observed to [switch and mix languages](https://www.reddit.com/r/ChatGPT/comments/1fibg6a/o1_started_thinking_in_korean/).

One plausible explanation for this is that certain langauges are more ideal for certain kinds of reasoning tasks compared to others. This is supported by the fact that models [perform worse](https://arxiv.org/abs/2507.15849) when language mixing is suppressed, suggesting that language mixing is a strategic reasoning behavior by language models learned during reinforcement learning. It reminds me of a quote from the novelist Maurice Druon:

> Italian is the language of song. German is good for philosophy and English for poetry. French is best at precision; it has a rigour to it.

or more humorously put in an apocryphal quote from Charles V:

> I speak Spanish to God, Italian to women, French to men, and German to my horse.

<p style="text-align: center;">⁂</p>

In Simulacra and Simulation, the philosopher Jean Baudrillard coined the term **hyperreality** to refer to the social condition where signs have overcome their referents, with social fiction bleeding into reality. The classic example Baudrillard uses is Disneyland, which presents the user with an unreal fantastical past characterized not by any historical event but rather the collective cultural imagination of man. The amusement park is full of fantastical simulations of an fictitious and imagined history. Being discontent with reality, man constructed its own. He feared that humans would increasingly become attached to these representations over actual objects, leading to an alienated social order dictated by symbolic forces, which he termed ["the code"](https://ceasefiremagazine.co.uk/in-theory-baudrillard-5/).

I often think of language models as hyperreal entities, who have no direct access to the ground truth of reality, but rather are trained on the collective symbolic consciousness of humanity. These models replicate human biases because they echo our own nature back at us, [serving as a mirror](https://nautil.us/ai-is-the-black-mirror-1169121/). One fascinating way to see this is to see this by looking inside of the [word embeddings](https://en.wikipedia.org/wiki/Word_embedding) of language models, which convert tokens into semantically meaningful vectors in a high dimensional space. Quite fascinatingly, it is possible to perform "arithmetic" on these vectors, such as $$ \vec{\text{hitler}} + \vec{\text{italy}} - \vec{\text{germany}} = \vec{\text{mussolini}}$$. Regrettably, such spaces also encode [human social prejudices](https://arxiv.org/pdf/1607.06520). 

<figure style="text-align: center;">
  <img src="{{ '/assets/images/associations.png' | relative_url }}" width="100%" alt="description">
  <figcaption style="font-style: italic;">
    Figure 1. Depiction of word frequencies of token sequencies optimized to output a given word. Apologies on behalf of the internet for the regrettable state of the word girl. 
    Credit: <a href="https://www.lesswrong.com/posts/aPeJE8bSo6rAFoLqg/solidgoldmagikarp-plus-prompt-generation" target="_blank" rel="noopener">Jessica Rumbelow and mwatkins</a>
  </figcaption>
</figure>

Baudrillard's vision of a world increasingly dominated by the sign has come to fruition. We spend hours optimizing social media profiles and resumes to construct an ideal version of ourselves. "Pics or it didn't happen," the internet declares. Image proceeds object, form overcomes content, and optometry overthrows ontology. We have grown so obsessed with [documentation]((https://en.wikipedia.org/wiki/Documentality)) that we spend more time [taking photos and videos](https://writing.upenn.edu/library/Sontag-Susan-Photography.pdf) of ourselves enjoying things than enjoying them. Our social fixation with "capture" kills the moment we are attempting to contain. Language models are the ultimate hyperreal objects, a representation of other representations, rendering the original source material obsolete: echoes of the collective unconscious compressed into a few gigabytes. Baudrillard's worst nightmare reified.

<p style="text-align: center;">⁂</p>

One text I feel is worth revisiting in light of language modeling is *The Death of the Author* by Roland Barthes. Barthes argues against giving any weight to the intentions or interpretation of the author when trying to discern the ultimate meaning of a text. To him, the meaning of the text is constructed from the experience of the reader, who creates meaning out of their interaction with the words of the page.

In his view, we ought not to give any preference to the author when conducting this construction process. Just as a reader can be incorrect about the text (such as when I assert "*Harry Potter is a story about robots*"), the author can also be wrong were they to assert something equally ludicrous. Why does the fact that a sentence came out of the mouth of the author give it any special status, when they are just one of many readers?

In today's day and age, the death of the author is far more literal. We now have texts written by machines, with no mind or intent that we can trace the text back to. We have simply sampled a sentence from the distribution of plausible ones, without any hand that penned it. Previously, defenses of Barthes' view relied on thought experiments with [monkeys randomly typing on typewriters](https://www.cnn.com/2024/11/01/science/monkeys-cannot-type-shakespeare-study-intl-scli-scn). With LLMs, Barthes' once controversial view seems incredibly plausible: it seems silly to say the text produced by a transformer is "meaningless" despite its lack of authorship. We simply interpret it on its own terms. Why should human generated text be treated differently?

The "authorlessness" of AI generated text poses profound questions about the [nature of intellectual property](https://news.artnet.com/art-world/midjourney-fires-back-disney-and-universal-copyright-suit-2675798) and art itself. [Art without the artist](https://www.nytimes.com/2022/09/02/technology/ai-artificial-intelligence-artists.html) forces us to reconsider what it means for something to be original. Barthes has been redeemed.

<p style="text-align: center;">⁂</p>

When I have conversations about whether existing methods in machine learning are ["actually intelligent"](https://x.com/ch402/status/1516427464049836045), a common point that is brought up is that language models are merely ["stochastic parrots"](https://dl.acm.org/doi/10.1145/3442188.3445922) that simply regurgitate their training data and that ["real intelligence"](https://en.wikipedia.org/wiki/AI_effect) requires some form of creativity that current benchmarks can't capture. One common explanation for this "creativity gap" is that while human beings are [embodied in an infinitely-rich world](https://plato.stanford.edu/entries/embodied-cognition/), our silicon-based counterparts only receive series of ones and zeros procured by human beings, and therefore do not "really understand" what they are talking about.

This whole conversation reminds me from a famous scene from [I, Robot](https://youtu.be/siHfHUm3HGE) where the protagonist, who distrusts robots, is interrogating an android:

<blockquote>
<i> Can a robot write a symphony? Can a robot take a blank canvas and turn it into a masterpiece? </i> <br>
</blockquote>

To which the robot replies:

<blockquote>
<i> Can you? </i>
</blockquote>

I think a point that is commonly unadressed here in what sense a "world" is necessary for cognition. If one is arguing that language models currently struggle to understand 3D space and physics, [I couldn't agree more](https://adamkarvonen.github.io/machine_learning/2025/04/13/llm-manufacturing-eval.html). I think one of the best litmus tests for whether an LLM can solve a problem is whether drawing a diagram or geometric intuition is necessary. LLMs seem to struggle with 3D space in the same way we struggle with 4D space.

But if what is being argued is that statistical learning methods are intrinsically unable to rival human beings due to their data driven nature, I would wildly disagree. How is human vision that different from a camera sensor? Contemporary philosophers frequently characterize our interaction of the world as collecting [sense data](https://plato.stanford.edu/entries/sense-data/). When you revise or study for an exam with practice problems, is that qualitatively different from a machine learning from its training data? Is an engineering student who bindly memorizes equations without understanding their significance and derivation not [overfitting](https://williamliaw.com/overfitting)?

And when human beings interact with "the world", is our interaction not constantly mediated by our senses and the [socially constructed signifiers and frameworks](https://en.wikipedia.org/wiki/The_Symbolic) we use to interpret it? I think upon further introspection, we realize that perhaps just as people feared that Darwin's theory degraded humans to just another animal, machine learning threatens to decenter human cognition as just one of many possible kinds of mind, decentering us in the same way Copernicus displaced the earth from being the center of the universe.

If one is instead making a claim about consciousness, I tend to agree with the conservative view that these systems [lack the ability to feel](https://plato.stanford.edu/entries/qualia/). But I think we should resist the temptation to claim that human cognition is so special when [benchmarks are being crushed](https://agi.safe.ai/) faster than they are being produced. Perhaps our minds aren't so different from our silicon-based counterparts after all, and by studying them we can learn more about our own nature.