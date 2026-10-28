# qol

Mods that change Claude Code's interface and behavior. These terms hold across every mod in this repo.

## Time spans

**Conversation**:
The exchange between `/clear` points: one `session_id` and one transcript. A new `claude` process or `/clear` starts a new conversation.
_Avoid_: Session, chat, thread

**5-hour window**:
The 5-hour rate-limit period of the user's subscription. Claude Code's `/usage` calls it "Current session"; the mods never do.
_Avoid_: Session, current session

**7-day window**:
The 7-day rate-limit period of the user's subscription.
_Avoid_: Week, weekly session

## Usage

**Request**:
One call to the API: one model response, with its own token counts. A conversation is a sequence of requests.
_Avoid_: Turn, message, call

**Subagent**:
A separate agent that a conversation launches to do part of its work. Its requests belong to the conversation that launched it and count in that conversation's total.
_Avoid_: Agent, sub-agent, task

**Input tokens**:
Tokens the request sends that are neither written to nor read from the cache.
_Avoid_: Prompt tokens, uncached tokens

**Cache write tokens**:
Tokens the request stores in the prompt cache, so later requests can read them for less.
_Avoid_: Cache creation, cache start

**Cache read tokens**:
Tokens the request takes from the prompt cache instead of sending them again.
_Avoid_: Cache hit, cached tokens

**Output tokens**:
Tokens the model writes in its response, thinking included.
_Avoid_: Completion tokens

**Total tokens**:
The sum of input, cache write, cache read and output tokens of a request or of a group of requests.

**Estimated cost**:
What a request would cost at API prices, per token type and in total. The user pays a subscription, so this is a measure of usage, not a bill.
_Avoid_: Cost, price, spend

**Conversation total**:
The sums of tokens and estimated cost over every request of one conversation.

**Window total**:
The sums of tokens and estimated cost over every request made inside the current 5-hour window or 7-day window, in any conversation.

## History

**History**:
The pane tab that lists every stored conversation, grouped by date, by project or by window.
_Avoid_: Log, archive

**Project**:
The working directory a conversation started in, shown by its last path segment.
_Avoid_: Repo, workspace

**Card**:
A bordered box in History that groups the conversations of one project, or of one 5-hour window.
_Avoid_: Panel, tile
