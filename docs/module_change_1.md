# Module Change (no. 1)

## Configurable components
Some components have settings about them that must be configurable.
For example: The HTTP request trigger should be configurable in regards to the address, method, URI, etc.
### Implementation:
Introduce a new **enum** type with variants. On the frontend this will be represented by a DropDown menu.
On the back end this type will be similar to the way other types are compiled to structs, but the enum
type will of course compile to an enum. It should also carry a repr function, which converts it to a string.
The enum type will also get its own constant component.

Each component carries a new field in definitions.json "tweaks". Each tweak has:
 - name
 - description
 - type
 - default

On the frontend these tweaks can be set by clicking on a node and changing it in the right hand side panel.

## Constructing and Destructing types
Introduce two new components (nodes). The **construct** and **destruct** component.

The construct component builds a new type (fields as input, built variant as output).

And the destruct component will split a type into its fields (variant as input, fields values as output)

## Sealed type group
The **sealed** type *GROUP* is an abstraction over arbitrary Go types. It can not be constructed or destructed.
It can only be used as input and output from nodes. The frontend user only sees the name, but not any of its fields.
And the user may not create their own one.

This is useful for things which can not be represented by primitives, arrays or dicts, like Connections for example.

**Sealed** is treated like a tag for types. It only *really* matters on the frontend and as modifiers.
A module which has a sealed type must however specify that this type is sealed in its `definitions.json`.
If a type is sealed or not does not matter for the compiled Go code, but just allows handling complex types.
