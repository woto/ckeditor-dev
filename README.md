# Contributing through Ticket Branches

This repository is a development space designed for contributing to the
development of the main [ckeditor-dev][1] repository of CKEditor.

## The master Branch

The master branch of this repository is intentionally empty, containing this
readme file only. There is no master code here, having all branches usually
targeting one of the original CKEditor branches.

## The "Ticket Branches" 

All branches in this repository follow the same **naming convention: t/xyz**.
The "xyz" part refers to a ticket number in the CKEditor development site. For
example, an hypothetical branch name `t/123` should contain fixes for the
ticket [#123](http://dev.ckeditor.com/ticket/123). That's why these branches are
called "ticket branches".

All ticket branches were created out of the original CKEditor branches (usually
[master][2] or [major][3]).

## Warning!

The fixes introduced in the tickets branches are still under development. These
branches may be incomplete, unstable or broken. They are still pending review
 from the CKEditor core team and their successive "masterisation".

Additionally, there are no strictly rules regarding "force pushing"
(git push -f) and "rebasing" on these branches, so don't expect their commits
hashes to stay stable. Operations like commits reordering and squashing are
accepted.

Finally, once masterised, ticket branches are deleted.

## Contributing to CKEditor (Yeah!)

You can easily contribute to CKEditor editor:

 1. **Fork** the [ckeditor-dev repository][1].
 2. **Push** ticket branches into your fork.
 3. **Start pull requests** for your ticket branches directly on GitHub.

The ticket branching system is well accepted by the CKEditor core team being it
their everyday working model.

Good coding!


[1]: https://github.com/ckeditor/ckeditor-dev "CKEditor main repository"
[2]: https://github.com/ckeditor/ckeditor-dev/tree/master "CKEditor master branch"
[3]: https://github.com/ckeditor/ckeditor-dev/tree/major "CKEditor major branch"
