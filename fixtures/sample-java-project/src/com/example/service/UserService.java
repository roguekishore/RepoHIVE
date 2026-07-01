package com.example.service;

import com.example.model.User;
import com.example.model.Account;

/**
 * Service that depends on model types via explicit imports. Each import that
 * resolves through the symbol table becomes a file -> class dependency edge.
 * Contains an inner type and overloaded methods.
 */
public class UserService {
    public User create(String name, long id) {
        return new User(name, id);
    }

    public Account open(User owner) {
        return new Account(owner);
    }

    // Overloaded create: distinct parameter-type list.
    public User create(String name) {
        return new User(name, 0L);
    }

    /** Inner (non-static) type -> nested class node. */
    public class Session {
        private final User user;

        public Session(User user) {
            this.user = user;
        }

        public User user() {
            return user;
        }
    }
}
