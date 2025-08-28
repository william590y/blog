---
layout: post
title:  "Poststructuralism and Language Models"
date:   2025-08-28 00:10:27 -0500
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

 As the 20th century progressed, post-structuralist philosophers overthrew this framework and tore it to shreds. Meaning is not to be found in the relationship between a text and the object outside it, but rather in the relationship between text and other texts. The dictionary defines words in terms of other words, implying meaning emerges in a recursive network of similarities, oppositions, and connections between words rather than the way words reflect an outside world. This position was (in)famously advanced by the philosopher [**Jacques Derrida**](https://en.wikipedia.org/wiki/Jacques_Derrida), who declared in his magnum opus *On Grammatology* that "**there is nothing outside of the text**".

 This hypothesis, while regarded as deeply radical and controversial during Derrida's lifetime, has essentially been confirmed by the advent of language modeling. Without any knowledge of the outside world, LLMs reproduce the entire structure of human language purely from the statistical correlations and associations between words. The entire corpus of human knowledge compressed into a GPU using nothing outside the text.

<p style="text-align: center;">⁂</p>

It is quite rare that philosophical questions are resolved by empirical answers. Most philosophical questions are sufficiently ethereal and intangible that science never manages to latch its fingers onto it: think the existence of God or the objectivity of morality. But every once in a while, the scientific method manages to render an objective answer to a philosophical quandries. One famous example of such a resolution is **Molyneaux's problem**, which asks whether:

<blockquote>
*if a man born blind can feel the differences between shapes such as spheres and cubes, could he, if given the ability to see, distinguish those objects by sight alone, in reference to the tactile schemata he already possessed*

-Locke (1689)
 </blockquote>

This question was considered a major point of contention between [rationalists and empiricists](https://plato.stanford.edu/entries/rationalism-empiricism/), who argued that knowledge came from logical reasoning or sense data respectively. It was resolved [in favor of the empiricists](https://pubmed.ncbi.nlm.nih.gov/21478887/) in 2003 when neuroscience professor Pawan Sinha restored vision to subjects with total congenital blindness and tested subjects to see if they could distinguish objects visually as well as by touch. In the visual domain, the subject performed barely better than guessing.

In hindsight, this result makes a large degree of intuitive sense from the hyper-empiricist standpoint of statistical learning theory. How would a person with newly restored vision after years of blindness have any intuition about what their senses are indicating? But it is also easy to see how this absent this framework, such a question poses quite the dilemma.

Another example of this phenomenon is Einstein's theory of General Relativity. For a long time, there was extensive debate between the so called A and B theories of time. A theory, often referred to as **presentism**, posits that the past and future are unreal and truly exists. B theory, often called **eternalism**, instead posits that the past, present, and future are all equally real.

In special relativity, the notion of simultaneity depends on your frame of reference, meaning that there is no universal notion of the present. In general relativity, simultaneity is even weaker, and is not only **relative** but **local**, meaning there is no notion of what is happening "now" for objects far away. This essentially kills off the A theory of time. Gravity emerging from the curvature of a unified block of spacetime hammers down the last nail in the coffin for presentism.

<p style="text-align: center;">⁂</p>

One direction I feel has not been explored nearly enough is how the nature of language models can provide new insight into long-standing issues in the philosophy of language. One such perrenial issue is the relationship between language and thought. The **Sapir-Whorf hypothesis** asserts that language influences the scope of human thought. The now debunked **strong hypothesis** asserts that language *determines* thought and that human reasoning can not extend beyond what language describes. The [Hopi language](https://en.wikipedia.org/wiki/Hopi_time_controversy), once a poster child for this notion, contains no explicit words for past and future and is very close to a tenseless language. Whorf believed that this showed the the Hopi have no notion of the flow time, an idea that has been [empirically invalidated](https://books.google.com/books?hl=en&lr=&id=Orpzv3su5twC&oi=fnd&pg=PA1&dq=hopi+time&ots=jhTjctVdaj&sig=PWjdijLY9EM_C7Rvhb_BJQ8xSGc#v=onepage&q=hopi%20time&f=false), with the modern consensus being that the Hopi simply discuss time via spatial analogies, albeit in a slightly more event-based fashion.

On the other hand, the **weak hypothesis**, which posits that language use merely influences the way we think, has enjoyed some scant (and at times sketchy) empirical support and is still the subject of [great](https://youtu.be/5YXXGHwmogU) [controversy](https://youtu.be/CmZdGo6b5yA).

One interesting piece of evidence in favor of weak Sapir-Whorf is language mixing in LLMs. The tendency for bilingual language models to switch and mix languages selectively during reasoning was first observed in [DeepSeek-R1](https://arxiv.org/abs/2501.12948), where the authors discuss how they had to structure the reward function in order to prevent the model from mixing languages during reinforcement learning. Other RL trained thinking models such as OpenAI's o1 model have been observed to [switch and mix languages](https://www.reddit.com/r/ChatGPT/comments/1fibg6a/o1_started_thinking_in_korean/).

One plausible explanation for this is that certain langauges are more ideal for certain kinds of reasoning tasks compared to others. This is supported by the fact that models [perform worse](https://arxiv.org/abs/2507.15849) when language mixing is suppressed, suggesting that language mixing is a strategic reasoning behavior by language models learned during reinforcement learning. It reminds me of a quote from the novelist Maurice Druon:

> Italian is the language of song. German is good for philosophy and English for poetry. French is best at precision; it has a rigour to it.

or more humorously put in an apocryphal quote from Charles V:

> I speak Spanish to God, Italian to women, French to men, and German to my horse.

<p style="text-align: center;">⁂</p>

In Simulacra and Simulation, the philosopher 