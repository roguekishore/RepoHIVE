package com.example.model;

/**
 * A domain user. Referenced across packages via imports so the parser produces
 * cross-file dependency edges. Includes an overloaded method and a nested type.
 */
public class User {
    private final String name;
    private final long id;

    public User(String name, long id) {
        this.name = name;
        this.id = id;
    }

    public String getName() {
        return name;
    }

    // Overload: same name, different parameter-type list -> distinct function node.
    public String getName(String prefix) {
        return prefix + name;
    }

    public long getId() {
        return id;
    }

    /** Nested (static) type -> distinct class node with a $-joined FQN. */
    public static final class Role {
        private final String label;

        public Role(String label) {
            this.label = label;
        }

        public String label() {
            return label;
        }
    }
}
