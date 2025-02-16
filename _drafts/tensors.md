---
layout: post
title:  "Tensors Demystified"
date:   2025-02-13 08:30:27 -0500
categories: jekyll update
author: William
tags: Mathematics
excerpt_separator: <!--more-->
---

What the hell all those indices mean once and for all

<!--more-->

Tensors are rather infamously introduced in physics classes with the following tautology: 

> a tensor is an object that transforms like a tensor. 

When I was first trying to learn General Relativity, I was frustrated by the lack of intuition I had when working with tensors. The vast majority of resources on this topic on the internet are often either far too theoretical for beginners or lack motivation for why objects that these are physical. My goal with this post is to make tensors appear as natural and motivated generalizations of vector spaces and explain why they are ubiquitous in our best theories of physics.

<p style="text-align: center;">⁂</p>

In computer science, a "tensor" of rank n refers to a multi-dimensional array where n indices are required to index any element. In physics and mathematics, this is not enough, we demand more: our tensors must transform in a certain manner under a change of coordinates in order to ensure they faithfully represent something geometric.

To see this, let's step back and talk about what constitutes a vector, which is a rank 1 tensor. Not every list of numbers can be a vector: if I take the number of apples, grapes, and lemons I bought at the grocery store, this fails to form a vector because it does represent any underlying geometric object. On the other hand, displacement is a vector (e.g. the vector extending between my chimney and my fireplace). If I choose different basis vectors, or rotate my coordinate system, the coordinates I use to represent the displacement may change, but the underlyling geometric object remains unchanged (which I whimsically think of as a giant imaginary arrow). In contrast, position, which extends from the origin of our coordinate system to a given point in space. If we change the origin of our coordinate system, the underlying object does actually change, and hence the coordinates do not transform like a vector.

We can formalize this as follows for a point $$x \in \mathbb{R} ^n$$

$$\displaystyle x_j = \sum^n_{i=0} R_{ij} x_i$$. 

In this article, we will be using [Einstein notation](https://en.wikipedia.org/wiki/Einstein_notation), where we drop the sigma notation and implicitly assume summation over repeated indices in the same term.