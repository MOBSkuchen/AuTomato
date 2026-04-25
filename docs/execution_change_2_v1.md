# Execution change (no. 2)
Rework of the core execution logic, specifically for setup and triggers.

## One core, multiple triggers
Until now there has only been one trigger allowed. This makes sense, because a workflow maps one action.
However, this isn't very flexible, since we occupy one entire program for a single action.
For example, if a user has an HTTP server and wants to create a workflow on top of it, 
the workflow can only handle one route and occupies the entire server (address).

To fix this, we introduce a setup / init path, which leads to a "Dispatch" node, which can connect to multiple triggers.
This Dispatch node is essentially only a struct and the possible triggers are method of it.

The Workflow now begins with an "Origin" node. The origin node is the equivalent of the "main" function.
It can connect to any other node, because it is just a regular node.
It leads to the aforementioned dispatch node, which is the only node that can connect to a trigger node via the input side.

### Implementation

We compile the Workflow like normal, until the dispatch node. This code goes into the main function.
Then we call a new generated dispatch function with the dispatch struct. In this function, 
for each trigger we call a "new trigger" method on the struct and end by calling a "run" method.

The "new trigger" method takes in the callback function and some settings, like there were with triggers (for example route, method, etc.).

The "new trigger" method, the triggers, the "run" method and the dispatch struct must be defined by the module itself, 
or borrowed from another, and must be compliant with this spec.
The names of these things can be flexible, as they should be declared in `definitions.json`.

## Flexibility
This process requires a lot of boilerplate and is also not necessary for other use cases, like simple cron jobs.
That's we keep the old way of doing stuff. The trigger node can also act as an entry point, but can only occur once
in the workflow (without a dispatch node) and can not be used in the same workflow as an origin node.

The component may be declared as one of the following:
- reliant on dispatch node
- handles both (with a default dispatch struct)
- doesn't take in a dispatch node

## Smaller things

### Env constant
(Incompatible with TinyGo)

A constant that is configured with a two string, the env key and a default, and outputs a string.
This obviously just loads in the environment key or outputs the default, if it is not found.
Not that the configuration are explicitly NOT inputs.

### Exit node
Special kind of node, which exits the program.
Takes in an optional input, the return code.