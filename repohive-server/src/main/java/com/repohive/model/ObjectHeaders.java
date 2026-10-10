package com.repohive.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonInclude;

/** The headers an object is stored with: the `.headers.json` sidecar. */
@JsonInclude(JsonInclude.Include.NON_NULL)
@JsonIgnoreProperties(ignoreUnknown = true)
public record ObjectHeaders(String contentType, String contentEncoding, String cacheControl) {

    public static ObjectHeaders of(String contentType) {
        return new ObjectHeaders(contentType, null, null);
    }
}
